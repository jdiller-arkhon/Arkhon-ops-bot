import { arkhonEmbed, truncate, UserFacingError } from '@arkhon/shared';
import type { OpsModAction } from '@prisma/client';
import type { GuildMember, User } from 'discord.js';
import type { OpsContext } from '../context.js';
import { isStaff } from '../permissions.js';

export type ModActionType = 'warn' | 'timeout';

/** Discord's maximum timeout is 28 days. */
export const MAX_TIMEOUT_MINUTES = 28 * 24 * 60;

/** Rejects moderation targets that must not be actioned by this moderator. */
export function assertModeratable(
  moderator: GuildMember,
  target: GuildMember,
  ctx: OpsContext,
): void {
  if (target.id === moderator.id) throw new UserFacingError('You cannot moderate yourself.');
  if (target.user.bot) throw new UserFacingError('Bots cannot be moderated with this command.');
  if (target.id === target.guild.ownerId)
    throw new UserFacingError('The server owner cannot be moderated.');
  if (isStaff(target, ctx.layout.require()))
    throw new UserFacingError('Staff members cannot be moderated with this command.');
  if (
    moderator.id !== moderator.guild.ownerId &&
    moderator.roles.highest.comparePositionTo(target.roles.highest) <= 0
  ) {
    throw new UserFacingError('You can only moderate members below your highest role.');
  }
}

export async function recordModAction(
  ctx: OpsContext,
  input: {
    guildId: string;
    target: User;
    moderator: User;
    action: ModActionType;
    reason: string;
    durationMinutes?: number;
  },
): Promise<OpsModAction> {
  const record = await ctx.prisma.opsModAction.create({
    data: {
      guildId: input.guildId,
      targetId: input.target.id,
      moderatorId: input.moderator.id,
      action: input.action,
      reason: input.reason,
      durationMinutes: input.durationMinutes ?? null,
    },
  });

  const fields = [
    { name: 'Member', value: `${input.target} (${input.target.id})`, inline: true },
    { name: 'Moderator', value: `${input.moderator}`, inline: true },
    { name: 'Reason', value: truncate(input.reason, 1024) },
  ];
  if (input.durationMinutes) {
    fields.splice(2, 0, {
      name: 'Duration',
      value: formatMinutes(input.durationMinutes),
      inline: true,
    });
  }
  const modLogId = ctx.layout.require().channels.modLog;
  const modLog = await ctx.client.channels.fetch(modLogId).catch(() => null);
  if (modLog?.isSendable()) {
    await modLog.send({
      embeds: [
        arkhonEmbed({
          title: `${input.action === 'warn' ? '⚠️ Warning' : '🔇 Timeout'} · case #${record.id}`,
          fields,
          timestamp: record.createdAt,
        }),
      ],
      allowedMentions: { parse: [] },
    });
  } else {
    ctx.logger.error({ channelId: modLogId }, 'mod-log channel unavailable');
  }
  ctx.logger.info(
    {
      caseId: record.id,
      action: input.action,
      targetId: input.target.id,
      moderatorId: input.moderator.id,
    },
    'moderation action recorded',
  );
  return record;
}

export function formatMinutes(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

export async function modHistory(ctx: OpsContext, guildId: string, targetId: string, limit = 15) {
  const [actions, total] = await Promise.all([
    ctx.prisma.opsModAction.findMany({
      where: { guildId, targetId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    ctx.prisma.opsModAction.count({ where: { guildId, targetId } }),
  ]);
  return { actions, total };
}
