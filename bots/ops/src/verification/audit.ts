import { arkhonEmbed, truncate } from '@arkhon/shared';
import type { OpsContext } from '../context.js';

export type VerificationEventType =
  | 'started'
  | 'linked'
  | 'unlinked'
  | 'failed'
  | 'blocked_age'
  | 'blocked_rate'
  | 'blocked_lockdown'
  | 'blocked_duplicate'
  | 'lockdown_on'
  | 'lockdown_off'
  | 'role_stripped';

const LABELS: Record<VerificationEventType, string> = {
  started: '🔐 Verification started',
  linked: '✅ Member verified',
  unlinked: '🔓 Member unlinked',
  failed: '⚠️ Verification failed',
  blocked_age: '⛔ Blocked: account too new',
  blocked_rate: '⛔ Blocked: too many attempts',
  blocked_lockdown: '⛔ Blocked: lockdown active',
  blocked_duplicate: '⛔ Blocked: ID already linked elsewhere',
  lockdown_on: '🚨 Raid lockdown started',
  lockdown_off: '🟢 Raid lockdown ended',
  role_stripped: '🧹 Product role removed from unverified member',
};

/** Events worth a #mod-log post. "started" is stored but not posted, to keep the log readable. */
const POSTED: ReadonlySet<VerificationEventType> = new Set([
  'linked',
  'unlinked',
  'blocked_age',
  'blocked_rate',
  'blocked_duplicate',
  'lockdown_on',
  'lockdown_off',
  'role_stripped',
]);

export interface VerificationEventInput {
  type: VerificationEventType;
  discordUserId?: string;
  memberId?: string;
  detail?: string;
  actorId?: string;
}

/** Stores a verification event and, for notable ones, posts it to #mod-log. Never throws. */
export async function recordVerificationEvent(
  ctx: OpsContext,
  event: VerificationEventInput,
): Promise<void> {
  try {
    await ctx.prisma.opsVerificationEvent.create({
      data: {
        type: event.type,
        discordUserId: event.discordUserId ?? null,
        memberId: event.memberId ?? null,
        detail: event.detail ? truncate(event.detail, 500) : null,
        actorId: event.actorId ?? null,
      },
    });
  } catch (error) {
    ctx.logger.error({ err: error, event }, 'could not store verification event');
  }
  ctx.logger.info({ ...event }, 'verification event');

  const layout = ctx.layout.current;
  if (!layout || !POSTED.has(event.type)) return;
  try {
    const channel = await ctx.client.channels.fetch(layout.channels.modLog);
    if (!channel?.isSendable()) return;
    const fields = [
      ...(event.discordUserId
        ? [
            {
              name: 'Discord',
              value: `<@${event.discordUserId}> (${event.discordUserId})`,
              inline: true,
            },
          ]
        : []),
      ...(event.memberId
        ? [{ name: 'Member ID', value: `\`${event.memberId}\``, inline: true }]
        : []),
      ...(event.actorId ? [{ name: 'By', value: `<@${event.actorId}>`, inline: true }] : []),
      ...(event.detail ? [{ name: 'Detail', value: truncate(event.detail, 1024) }] : []),
    ];
    await channel.send({
      embeds: [arkhonEmbed({ title: LABELS[event.type], fields, timestamp: true })],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    ctx.logger.warn({ err: error }, 'could not post verification event to mod-log');
  }
}
