import type { Guild } from 'discord.js';
import { PRODUCTS } from '@arkhon/shared';
import type { OpsContext } from '../context.js';
import { isStaff } from '../permissions.js';
import { CommunityApiError } from './api.js';
import { recordVerificationEvent } from './audit.js';
import { applyMemberLink, removeMemberLink } from './service.js';

/** Event ids only matter inside the 5-minute signature window; keep a day for diagnosis. */
const WEBHOOK_EVENT_RETENTION_MS = 86_400_000;

export interface ReconcileSummary {
  checked: number;
  unlinked: number;
  relinked: number;
  aborted: boolean;
}

/**
 * Makes Discord match the website, the source of truth. Website events are best-effort, so a
 * missed `member.unlinked` (bot restarting, network blip) would otherwise leave someone verified
 * forever. Checks every stored link and every Verified role holder.
 *
 * Stops at the first outage or auth error without removing anything: an unreachable website must
 * never strip access from real members.
 */
export async function reconcileMemberLinks(
  ctx: OpsContext,
  guild: Guild,
): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { checked: 0, unlinked: 0, relinked: 0, aborted: false };
  const api = ctx.security.api;
  const layout = ctx.layout.current;
  if (!api || !layout) return summary;

  const rows = await ctx.prisma.opsMemberLink.findMany();
  const verifiedRole = guild.roles.cache.get(layout.roles.verified);
  const ids = new Set([
    ...rows.map((r) => r.discordUserId),
    ...(verifiedRole?.members.keys() ?? []),
  ]);
  const stored = new Map(rows.map((r) => [r.discordUserId, r]));

  for (const discordUserId of ids) {
    const member = guild.members.cache.get(discordUserId);
    // Staff may hold Verified for testing without a member ID; leave them alone.
    if (member && !stored.has(discordUserId) && isStaff(member, layout)) continue;
    summary.checked += 1;
    try {
      const link = await api.getLink(discordUserId);
      const isNew = await applyMemberLink(
        ctx,
        {
          discordUserId,
          memberId: link.memberId,
          accountRole: link.accountRole,
          linkedAt: new Date(link.linkedAt),
        },
        'resync',
      );
      if (isNew) summary.relinked += 1;
    } catch (error) {
      if (error instanceof CommunityApiError && error.code === 'not_linked') {
        await removeMemberLink(ctx, discordUserId, {
          reason: 'Not linked on arkhonindustries.com (periodic check)',
          source: 'resync',
          notifyWebsite: false,
        });
        summary.unlinked += 1;
        continue;
      }
      ctx.logger.warn(
        { err: error, discordUserId },
        'member reconciliation stopped: website unavailable',
      );
      summary.aborted = true;
      break;
    }
  }

  await ctx.prisma.opsWebhookEvent
    .deleteMany({
      where: { receivedAt: { lt: new Date(Date.now() - WEBHOOK_EVENT_RETENTION_MS) } },
    })
    .catch(() => undefined);
  ctx.security.attempts.prune();
  ctx.logger.info({ ...summary }, 'member reconciliation finished');
  return summary;
}

/**
 * Product roles require Verified. Removes them from anyone who has them without being verified
 * (members from before verification existed, or Verified removed by hand). Staff are exempt.
 * Only runs when verification is configured, so members are never stuck without a way back in.
 */
export async function sweepUnverifiedProductRoles(ctx: OpsContext, guild: Guild): Promise<number> {
  const layout = ctx.layout.current;
  if (!layout || !ctx.security.api) return 0;
  const productRoles = PRODUCTS.map((p) => layout.roles.user[p]);
  let stripped = 0;
  for (const member of guild.members.cache.values()) {
    if (member.user.bot || member.roles.cache.has(layout.roles.verified) || isStaff(member, layout))
      continue;
    const held = productRoles.filter((id) => member.roles.cache.has(id));
    if (held.length === 0) continue;
    await member.roles.remove(held, 'Product roles require verification').catch(() => undefined);
    stripped += 1;
  }
  if (stripped > 0) {
    await recordVerificationEvent(ctx, {
      type: 'role_stripped',
      detail: `Removed product roles from ${stripped} unverified member${stripped === 1 ? '' : 's'}. They regain access after verifying in #verify.`,
    });
  }
  return stripped;
}
