import { arkhonEmbed, parseMemberId, truncate, UserFacingError } from '@arkhon/shared';
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
import { requireModerator, requireStaff } from '../permissions.js';
import { CommunityApiError } from '../verification/api.js';
import { applyMemberLink, removeMemberLink } from '../verification/service.js';
import { accountAgeDays } from '../verification/shield.js';

export const data = new SlashCommandBuilder()
  .setName('member')
  .setDescription('Look up and manage verified member links (staff only)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('lookup')
      .setDescription("Show a Discord user's linked member ID and verification history")
      .addUserOption((opt) => opt.setName('user').setDescription('Discord user').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('find')
      .setDescription('Find the Discord account linked to a member ID')
      .addStringOption((opt) =>
        opt
          .setName('member-id')
          .setDescription('ARK-XXXXX-XXXXX')
          .setRequired(true)
          .setMaxLength(20),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('unlink')
      .setDescription('Unlink a member ID from a Discord account and remove their access')
      .addUserOption((opt) => opt.setName('user').setDescription('Discord user').setRequired(true))
      .addStringOption((opt) =>
        opt
          .setName('reason')
          .setDescription('Reason (shown in the audit log)')
          .setRequired(true)
          .setMaxLength(200),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('resync')
      .setDescription("Re-check a user's link with arkhonindustries.com and fix their roles")
      .addUserOption((opt) => opt.setName('user').setDescription('Discord user').setRequired(true)),
  );

async function historyFor(ctx: OpsContext, where: { discordUserId?: string; memberId?: string }) {
  const events = await ctx.prisma.opsVerificationEvent.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 8,
  });
  return events.length === 0
    ? 'No verification activity.'
    : events
        .map(
          (e) =>
            `${time(e.createdAt, TimestampStyles.ShortDateTime)} · **${e.type}**${e.detail ? ` — ${truncate(e.detail, 80)}` : ''}`,
        )
        .join('\n');
}

export async function execute(
  interaction: ChatInputCommandInteraction,
  ctx: OpsContext,
): Promise<void> {
  const sub = interaction.options.getSubcommand();
  // Moderators may look people up; unlink and resync change the member's link on the website,
  // so they are limited to ticket staff, the Arkhon Team and admins.
  const staff =
    sub === 'unlink' || sub === 'resync'
      ? requireStaff(interaction, ctx)
      : requireModerator(interaction, ctx);
  const layout = ctx.layout.require();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (sub === 'lookup') {
    const user = interaction.options.getUser('user', true);
    const link = await ctx.prisma.opsMemberLink.findUnique({ where: { discordUserId: user.id } });
    const member = await staff.guild.members.fetch(user.id).catch(() => null);
    await interaction.editReply({
      embeds: [
        arkhonEmbed({
          title: `Member lookup: ${user.tag}`,
          fields: [
            {
              name: 'Member ID',
              value: link ? `\`${link.memberId}\`` : 'Not linked',
              inline: true,
            },
            { name: 'Account role', value: link?.accountRole ?? '—', inline: true },
            {
              name: 'Linked',
              value: link ? time(link.linkedAt, TimestampStyles.RelativeTime) : '—',
              inline: true,
            },
            {
              name: 'Verified role',
              value: member
                ? member.roles.cache.has(layout.roles.verified)
                  ? 'Yes'
                  : 'No'
                : 'Not in server',
              inline: true,
            },
            {
              name: 'Discord account age',
              value: `${Math.floor(accountAgeDays(user.id))} days`,
              inline: true,
            },
            { name: 'Recent activity', value: await historyFor(ctx, { discordUserId: user.id }) },
          ],
        }),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (sub === 'find') {
    const parsed = parseMemberId(interaction.options.getString('member-id', true));
    if (!parsed.ok)
      throw new UserFacingError(
        'That is not a valid member ID (format or check character is wrong).',
      );
    const link = await ctx.prisma.opsMemberLink.findUnique({
      where: { memberId: parsed.memberId },
    });
    await interaction.editReply({
      embeds: [
        arkhonEmbed({
          title: `Member ID ${parsed.memberId}`,
          fields: [
            {
              name: 'Linked Discord account',
              value: link
                ? `<@${link.discordUserId}> (${link.discordUserId})`
                : 'Not linked in this server',
            },
            ...(link
              ? [{ name: 'Linked', value: time(link.linkedAt, TimestampStyles.RelativeTime) }]
              : []),
            {
              name: 'Recent activity',
              value: await historyFor(ctx, { memberId: parsed.memberId }),
            },
          ],
        }),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (sub === 'unlink') {
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason', true);
    const removed = await removeMemberLink(ctx, user.id, {
      reason,
      source: 'staff',
      actorId: staff.id,
      notifyWebsite: true,
    });
    await interaction.editReply(
      removed
        ? `🔓 Unlinked ${user} and removed their access. They can verify again with their own member ID.`
        : `${user} had no linked member ID. Any Verified or product roles were removed.`,
    );
    return;
  }

  if (sub === 'resync') {
    const user = interaction.options.getUser('user', true);
    if (!ctx.security.api)
      throw new UserFacingError(
        'Verification is not configured, so there is nothing to resync with.',
      );
    try {
      const link = await ctx.security.api.getLink(user.id);
      await applyMemberLink(
        ctx,
        {
          discordUserId: user.id,
          memberId: link.memberId,
          accountRole: link.accountRole,
          linkedAt: new Date(link.linkedAt),
        },
        'resync',
      );
      await interaction.editReply(
        `✅ ${user} is linked to \`${link.memberId}\` on arkhonindustries.com. Roles are up to date.`,
      );
    } catch (error) {
      if (error instanceof CommunityApiError && error.code === 'not_linked') {
        await removeMemberLink(ctx, user.id, {
          reason: 'Not linked on arkhonindustries.com (resync)',
          source: 'resync',
          actorId: staff.id,
          notifyWebsite: false,
        });
        await interaction.editReply(
          `${user} is not linked on arkhonindustries.com, so their access was removed.`,
        );
        return;
      }
      if (error instanceof CommunityApiError)
        throw new UserFacingError(
          'arkhonindustries.com is not reachable right now. Try again shortly.',
        );
      throw error;
    }
    return;
  }

  throw new Error(`Unknown /member subcommand ${sub}`);
}
