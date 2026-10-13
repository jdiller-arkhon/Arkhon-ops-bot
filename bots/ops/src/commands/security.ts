import { arkhonEmbed } from '@arkhon/shared';
import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  time,
  TimestampStyles,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { OpsContext } from '../context.js';
import { requireModerator } from '../permissions.js';
import { endLockdown, startLockdown } from '../verification/service.js';

export const data = new SlashCommandBuilder()
  .setName('security')
  .setDescription('Verification and raid shield controls (staff only)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub.setName('status').setDescription('Show verification and raid shield status'),
  )
  .addSubcommandGroup((group) =>
    group
      .setName('lockdown')
      .setDescription('Pause or resume new verifications and invites')
      .addSubcommand((sub) =>
        sub
          .setName('on')
          .setDescription('Start a lockdown now')
          .addIntegerOption((opt) =>
            opt
              .setName('minutes')
              .setDescription('Duration (default from config)')
              .setMinValue(1)
              .setMaxValue(1440),
          )
          .addStringOption((opt) =>
            opt.setName('reason').setDescription('Reason').setMaxLength(200),
          ),
      )
      .addSubcommand((sub) => sub.setName('off').setDescription('End the lockdown now')),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  ctx: OpsContext,
): Promise<void> {
  const staff = requireModerator(interaction, ctx);
  const layout = ctx.layout.require();
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (group === 'lockdown' && sub === 'on') {
    const minutes = interaction.options.getInteger('minutes') ?? undefined;
    const reason = interaction.options.getString('reason') ?? 'Started manually';
    const until = await startLockdown(ctx, staff.guild, reason, {
      actorId: staff.id,
      ...(minutes ? { minutes } : {}),
    });
    await interaction.editReply(
      `🚨 Lockdown on until ${time(until, TimestampStyles.ShortTime)}. New verifications are closed and invites are paused.`,
    );
    return;
  }
  if (group === 'lockdown' && sub === 'off') {
    await endLockdown(ctx, staff.guild, 'ended manually', staff.id);
    await interaction.editReply('🟢 Lockdown ended. Verification and invites are open again.');
    return;
  }

  if (sub === 'status') {
    const { verification, raid } = ctx.config;
    const lockdown = ctx.security.raid.state();
    const [verifiedCount, last24h] = await Promise.all([
      ctx.prisma.opsMemberLink.count(),
      ctx.prisma.opsVerificationEvent.groupBy({
        by: ['type'],
        where: { createdAt: { gte: new Date(Date.now() - 86_400_000) } },
        _count: { _all: true },
      }),
    ]);
    const counts = last24h.map((g) => `${g.type}: ${g._count._all}`).join(' · ') || 'none';
    await interaction.editReply({
      embeds: [
        arkhonEmbed({
          title: 'Security status',
          fields: [
            {
              name: 'Member verification',
              value: ctx.security.api ? `On · ${verification.websiteUrl}` : 'Off (not configured)',
              inline: true,
            },
            { name: 'Verified members', value: String(verifiedCount), inline: true },
            {
              name: 'Lockdown',
              value:
                lockdown.active && lockdown.until
                  ? `🚨 Active until ${time(new Date(lockdown.until), TimestampStyles.ShortTime)}${lockdown.reason ? ` (${lockdown.reason})` : ''}`
                  : 'Off',
              inline: true,
            },
            {
              name: 'Shield settings',
              value: [
                `Minimum Discord account age: ${verification.minAccountAgeDays} days`,
                `Attempts per hour: ${verification.maxAttemptsPerHour}`,
                `Lockdown trigger: ${raid.joinThreshold} joins in ${raid.windowSeconds}s (current: ${ctx.security.raid.recentJoins()})`,
                `Lockdown length: ${raid.lockdownMinutes} min`,
              ].join('\n'),
            },
            { name: 'Last 24 hours', value: counts },
            { name: 'Audit log', value: `<#${layout.channels.modLog}>` },
          ],
        }),
      ],
    });
    return;
  }

  throw new Error(`Unknown /security subcommand ${group ?? ''} ${sub}`);
}
