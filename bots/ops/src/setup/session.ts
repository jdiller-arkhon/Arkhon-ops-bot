import { arkhonEmbed, truncate, UserFacingError } from '@arkhon/shared';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type EmbedBuilder,
  type Guild,
} from 'discord.js';
import type { OpsContext } from '../context.js';
import { ids } from '../ids.js';
import { requireAdmin } from '../permissions.js';
import { executeBuildout, snapshotGuild, type BuildOptions, type BuildReport } from './apply.js';
import { pendingCreates, planBuildout, summarizePlan, type BuildPlan } from './plan.js';

/** A preview waiting for its admin to press Build. Lives in memory for 10 minutes. */
interface PendingBuild {
  userId: string;
  options: BuildOptions;
  expiresAt: number;
}

const PENDING_TTL_MS = 10 * 60_000;
const pending = new Map<string, PendingBuild>();
let buildInProgress = false;

export function isBuildInProgress(): boolean {
  return buildInProgress;
}

function list(names: string[], max = 1000): string {
  if (names.length === 0) return '—';
  return truncate(names.join(', '), max);
}

function optionLines(options: BuildOptions, community: boolean, roleIcons: boolean): string {
  const mark = (on: boolean) => (on ? '✅' : '➖');
  return [
    `${mark(options.serverSettings)} Server settings: verification, content filter, notifications, @everyone permissions`,
    `${mark(options.community)} Community: ${community ? 'already enabled' : 'enable (announcements, forum, stage, onboarding)'}`,
    `${roleIcons ? '✅' : '➖'} Role icons: ${roleIcons ? 'custom icon for every role' : 'need Boost Level 2 (applied on a later run once boosted)'}`,
    `${mark(options.onboarding)} Native Onboarding (off by default: verification gates the server instead)`,
  ].join('\n');
}

export function buildPreviewEmbed(
  plan: BuildPlan,
  options: BuildOptions,
  missingPermissions: string[],
): EmbedBuilder {
  const summary = summarizePlan(plan);
  const line = (label: string, s: { create: number; update: number; skip: number }) =>
    `**${label}:** ${s.create} new · ${s.update} existing${s.skip ? ` · ${s.skip} skipped` : ''}`;
  const creating = plan.items.filter((i) => i.action === 'create').map((i) => i.name);
  const notes = plan.items.filter((i) => i.note).map((i) => `${i.name}: ${i.note}`);
  const upToDate = pendingCreates(plan).length === 0;

  const embed = arkhonEmbed({
    title: 'Server buildout preview',
    description: [
      line('Roles', summary.role),
      line('Categories', summary.category),
      line('Channels', summary.channel),
      '',
      optionLines(options, plan.community, plan.roleIcons),
      '',
      upToDate
        ? '✅ **Everything in the blueprint already exists.** Building again re-applies names, colors, icons, topics, permissions and posted content. Nothing is duplicated.'
        : `🆕 **${creating.length} new item${creating.length === 1 ? '' : 's'} to add** (listed below). Everything that already exists is matched by its saved id or name and updated in place, never duplicated.`,
      'Channels and roles outside the blueprint are left alone. Run this after every bot update to catch up.',
    ].join('\n'),
    fields: [
      ...(creating.length > 0
        ? [{ name: `Will create (${creating.length})`, value: list(creating) }]
        : []),
      ...(notes.length > 0 ? [{ name: 'Notes', value: list(notes) }] : []),
      ...(plan.unmanaged.length > 0
        ? [
            {
              name: `Not in the blueprint, left as is (${plan.unmanaged.length})`,
              value: list(plan.unmanaged.map((c) => c.name)),
            },
          ]
        : []),
    ],
  });
  if (missingPermissions.length > 0) {
    embed.addFields({
      name: '⛔ The bot is missing permissions',
      value: truncate(
        `Grant the bot's role **Administrator** for the build (you can remove it afterwards), or add: ${missingPermissions.join(', ')}.`,
        1024,
      ),
    });
  }
  return embed;
}

export function registerPendingBuild(token: string, userId: string, options: BuildOptions): void {
  const now = Date.now();
  for (const [key, value] of pending) if (value.expiresAt < now) pending.delete(key);
  pending.set(token, { userId, options, expiresAt: now + PENDING_TTL_MS });
}

export function confirmButtons(token: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ids.setupConfirm(token))
      .setLabel('Build server')
      .setEmoji('🏗️')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(ids.setupCancel(token))
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );
}

function progressEmbed(done: string[], current: string | undefined): EmbedBuilder {
  const lines = [...done.map((step) => `✅ ${step}`), ...(current ? [`⏳ ${current}…`] : [])];
  return arkhonEmbed({
    title: 'Building the server',
    description: `${lines.join('\n')}\n\nThis usually takes under a minute. Leave this message open.`,
  });
}

export function buildReportEmbed(report: BuildReport): EmbedBuilder {
  const ok = report.warnings.length === 0;
  return arkhonEmbed({
    title: ok ? '✅ Server build complete' : '⚠️ Server build finished with warnings',
    description: [
      `Done in ${(report.durationMs / 1000).toFixed(1)}s. Panels, welcome and rules messages and AutoMod rules are live.`,
      '',
      '**Next steps**',
      '• Give your team the **Arkhon Team**, **Moderator**, **Certa Staff** and **Argus Staff** roles.',
      '• Upload a server icon and banner in Server Settings → Overview.',
      '• Run `/setup status` any time to check the layout.',
    ].join('\n'),
    fields: [
      { name: `Created (${report.created.length})`, value: list(report.created) },
      { name: `Updated (${report.updated.length})`, value: list(report.updated) },
      ...(report.skipped.length
        ? [{ name: `Skipped (${report.skipped.length})`, value: list(report.skipped) }]
        : []),
      ...(report.warnings.length
        ? [
            {
              name: `Warnings (${report.warnings.length})`,
              value: truncate(report.warnings.map((w) => `• ${w}`).join('\n'), 1024),
            },
          ]
        : []),
    ],
    timestamp: true,
  });
}

/** Plans against the live guild. Used for the preview and again right before building. */
export async function planForGuild(ctx: OpsContext, guild: Guild): Promise<BuildPlan> {
  return planBuildout(await snapshotGuild(ctx, guild));
}

export async function handleSetupButton(
  interaction: ButtonInteraction,
  action: string,
  token: string,
  ctx: OpsContext,
): Promise<void> {
  const member = requireAdmin(interaction, ctx);
  const entry = pending.get(token);
  if (!entry || entry.expiresAt < Date.now()) {
    pending.delete(token);
    throw new UserFacingError('This preview expired. Run `/setup server` again.');
  }
  if (entry.userId !== member.id)
    throw new UserFacingError('Only the admin who ran `/setup server` can confirm it.');

  if (action === 'cancel') {
    pending.delete(token);
    await interaction.update({
      content: 'Setup cancelled. Nothing was changed.',
      embeds: [],
      components: [],
    });
    return;
  }
  if (action !== 'confirm') throw new Error(`Unknown setup action ${action}`);
  if (buildInProgress)
    throw new UserFacingError('A build is already running. Wait for it to finish.');

  pending.delete(token);
  buildInProgress = true;
  const done: string[] = [];
  let current: string | undefined;
  try {
    await interaction.update({
      embeds: [progressEmbed(done, 'Reading the server')],
      components: [],
    });
    const plan = await planForGuild(ctx, member.guild);
    ctx.logger.info(
      { userId: member.id, options: entry.options, items: plan.items.length },
      'server buildout started',
    );
    const report = await executeBuildout(ctx, member.guild, plan, entry.options, async (step) => {
      if (current) done.push(current);
      current = step;
      await interaction
        .editReply({ embeds: [progressEmbed(done, current)] })
        .catch(() => undefined);
    });
    await interaction.editReply({ embeds: [buildReportEmbed(report)], components: [] });
  } finally {
    buildInProgress = false;
  }
}
