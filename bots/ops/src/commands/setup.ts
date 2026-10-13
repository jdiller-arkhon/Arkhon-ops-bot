import { arkhonEmbed, truncate, UserFacingError } from '@arkhon/shared';
import {
  GuildFeature,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { OpsContext } from '../context.js';
import { OPTIONAL_RESOURCES, REQUIRED_RESOURCES } from '../layout.js';
import { requireAdmin } from '../permissions.js';
import { missingBotPermissions, type BuildOptions } from '../setup/apply.js';
import {
  buildPreviewEmbed,
  confirmButtons,
  isBuildInProgress,
  planForGuild,
  registerPendingBuild,
} from '../setup/session.js';

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Build and inspect the Arkhon server layout (administrators only)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('server')
      .setDescription(
        'Preview, then build every role, category and channel from the Arkhon blueprint',
      )
      .addBooleanOption((opt) =>
        opt
          .setName('server-settings')
          .setDescription(
            'Apply verification, content filter and notification settings (default: on)',
          ),
      )
      .addBooleanOption((opt) =>
        opt
          .setName('community')
          .setDescription(
            'Enable Community: announcements, forum, stage, onboarding (default: on)',
          ),
      )
      .addBooleanOption((opt) =>
        opt
          .setName('onboarding')
          .setDescription(
            'Configure native Onboarding (default: off; conflicts with member verification)',
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('status').setDescription('Show which channels and roles the bot is using'),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  ctx: OpsContext,
): Promise<void> {
  const member = requireAdmin(interaction, ctx);
  const guild = member.guild;
  const sub = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const me = await guild.members.fetchMe();
  const missingPermissions = missingBotPermissions(me.permissions);

  if (sub === 'server') {
    if (isBuildInProgress())
      throw new UserFacingError('A build is already running. Wait for it to finish.');
    const options: BuildOptions = {
      serverSettings: interaction.options.getBoolean('server-settings') ?? true,
      community: interaction.options.getBoolean('community') ?? true,
      onboarding: interaction.options.getBoolean('onboarding') ?? false,
    };
    const plan = await planForGuild(ctx, guild);
    const embed = buildPreviewEmbed(plan, options, missingPermissions);
    if (missingPermissions.length > 0) {
      await interaction.editReply({ embeds: [embed] });
      return;
    }
    registerPendingBuild(interaction.id, member.id, options);
    await interaction.editReply({ embeds: [embed], components: [confirmButtons(interaction.id)] });
    return;
  }

  if (sub === 'status') {
    const { layout } = ctx;
    const describe = (key: string) => {
      const id = layout.ids[key];
      if (!id) return `❌ \`${key}\` not set`;
      const ref = key.startsWith('role.') ? `<@&${id}>` : `<#${id}>`;
      const exists = key.startsWith('role.')
        ? guild.roles.cache.has(id)
        : guild.channels.cache.has(id);
      const source = layout.sources[key] === 'env' ? ' · env override' : '';
      return `${exists ? '✅' : '⚠️ deleted'} ${ref}${source}`;
    };
    const ready = Boolean(layout.current);
    await interaction.editReply({
      embeds: [
        arkhonEmbed({
          title: ready ? 'Server layout: ready' : 'Server layout: setup needed',
          description: [
            ready
              ? 'All features have the channels and roles they need.'
              : 'Some required channels or roles are missing. Run `/setup server` to build them.',
            `**Community:** ${guild.features.includes(GuildFeature.Community) ? 'enabled' : 'off'}`,
            `**Bot permissions:** ${missingPermissions.length === 0 ? 'OK' : `missing ${missingPermissions.join(', ')}`}`,
          ].join('\n'),
          fields: [
            {
              name: 'Required',
              value: truncate(REQUIRED_RESOURCES.map(describe).join('\n'), 1024),
            },
            {
              name: 'Optional',
              value: truncate(OPTIONAL_RESOURCES.map(describe).join('\n'), 1024),
            },
          ],
        }),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }

  throw new Error(`Unknown /setup subcommand ${sub}`);
}
