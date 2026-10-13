import { arkhonEmbed, truncate, UserFacingError } from '@arkhon/shared';
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
import {
  assertModeratable,
  formatMinutes,
  MAX_TIMEOUT_MINUTES,
  modHistory,
  recordModAction,
} from '../moderation/service.js';
import { requireModerator } from '../permissions.js';

export const data = new SlashCommandBuilder()
  .setName('mod')
  .setDescription('Moderation tools (staff only)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('timeout')
      .setDescription('Time out a member')
      .addUserOption((opt) =>
        opt.setName('member').setDescription('Member to time out').setRequired(true),
      )
      .addIntegerOption((opt) =>
        opt
          .setName('minutes')
          .setDescription('Duration in minutes (max 40320 = 28 days)')
          .setMinValue(1)
          .setMaxValue(MAX_TIMEOUT_MINUTES)
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName('reason').setDescription('Reason').setMaxLength(500).setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('warn')
      .setDescription('Warn a member (they receive a DM)')
      .addUserOption((opt) =>
        opt.setName('member').setDescription('Member to warn').setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName('reason').setDescription('Reason').setMaxLength(500).setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('history')
      .setDescription('Show moderation history for a user')
      .addUserOption((opt) =>
        opt.setName('user').setDescription('User to look up').setRequired(true),
      ),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  ctx: OpsContext,
): Promise<void> {
  const moderator = requireModerator(interaction, ctx);
  if (!moderator.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    throw new UserFacingError('You need the Timeout Members permission to use /mod.');
  }
  const sub = interaction.options.getSubcommand();
  const guild = moderator.guild;

  if (sub === 'history') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.options.getUser('user', true);
    const { actions, total } = await modHistory(ctx, guild.id, user.id);
    const description =
      actions.length === 0
        ? 'No moderation actions on record.'
        : actions
            .map((a) => {
              const duration = a.durationMinutes ? ` (${formatMinutes(a.durationMinutes)})` : '';
              return `**#${a.id}** ${a.action}${duration} · ${time(a.createdAt, TimestampStyles.ShortDate)} by <@${a.moderatorId}>\n> ${truncate(a.reason, 200)}`;
            })
            .join('\n');
    await interaction.editReply({
      embeds: [
        arkhonEmbed({
          title: `Moderation history for ${user.tag}`,
          description:
            total > actions.length
              ? `${description}\n\nShowing ${actions.length} of ${total}.`
              : description,
        }),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }

  const targetUser = interaction.options.getUser('member', true);
  const reason = interaction.options.getString('reason', true);
  const target = await guild.members.fetch(targetUser.id).catch(() => null);
  if (!target) throw new UserFacingError('That user is not a member of this server.');
  assertModeratable(moderator, target, ctx);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (sub === 'timeout') {
    const minutes = interaction.options.getInteger('minutes', true);
    if (!target.moderatable)
      throw new UserFacingError('I cannot time out that member (check my role position).');
    await target.timeout(minutes * 60_000, `${moderator.user.tag}: ${reason}`);
    const record = await recordModAction(ctx, {
      guildId: guild.id,
      target: target.user,
      moderator: moderator.user,
      action: 'timeout',
      reason,
      durationMinutes: minutes,
    });
    await interaction.editReply(
      `🔇 ${target} timed out for ${formatMinutes(minutes)} (case #${record.id}).`,
    );
    return;
  }

  if (sub === 'warn') {
    const record = await recordModAction(ctx, {
      guildId: guild.id,
      target: target.user,
      moderator: moderator.user,
      action: 'warn',
      reason,
    });
    const dmed = await target
      .send({
        embeds: [
          arkhonEmbed({
            title: `You received a warning in ${guild.name}`,
            description: `**Reason:** ${reason}\n\nPlease review the server rules. Repeated issues may lead to a timeout.`,
          }),
        ],
      })
      .then(() => true)
      .catch(() => false);
    await interaction.editReply(
      `⚠️ ${target} warned (case #${record.id}).${dmed ? '' : ' They have DMs disabled, so they were not notified.'}`,
    );
    return;
  }

  throw new Error(`Unknown /mod subcommand ${sub}`);
}
