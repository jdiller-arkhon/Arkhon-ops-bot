import { arkhonEmbed, PRODUCTS } from '@arkhon/shared';
import type { Guild, GuildMember, PartialGuildMember } from 'discord.js';
import type { OpsContext } from '../context.js';
import { isUniqueViolation } from '../db.js';
import { isStaff } from '../permissions.js';
import { recordVerificationEvent } from './audit.js';

export interface MemberLinkInput {
  discordUserId: string;
  memberId: string;
  accountRole: string | null;
  linkedAt: Date;
}

export type LinkSource = 'webhook' | 'check' | 'resync';

async function fetchMember(ctx: OpsContext, discordUserId: string): Promise<GuildMember | null> {
  const guild = await ctx.client.guilds.fetch(ctx.config.discord.guildId).catch(() => null);
  return guild ? guild.members.fetch(discordUserId).catch(() => null) : null;
}

/**
 * Stores a verified link and grants the Verified role. Idempotent: the webhook and the
 * "I've approved" button can both deliver the same link, and only the first one announces it.
 * The website is the source of truth, so a member ID that moved to a new Discord account is
 * removed from the old one.
 */
export async function applyMemberLink(
  ctx: OpsContext,
  link: MemberLinkInput,
  source: LinkSource,
): Promise<boolean> {
  const layout = ctx.layout.require();
  const existing = await ctx.prisma.opsMemberLink.findUnique({
    where: { discordUserId: link.discordUserId },
  });
  const isNew = !existing || existing.memberId !== link.memberId;

  const stale = await ctx.prisma.opsMemberLink.findUnique({ where: { memberId: link.memberId } });
  if (stale && stale.discordUserId !== link.discordUserId) {
    await removeMemberLink(ctx, stale.discordUserId, {
      reason: 'Member ID was linked to a different Discord account on the website',
      source,
      notifyWebsite: false,
    });
  }

  const data = { memberId: link.memberId, accountRole: link.accountRole, linkedAt: link.linkedAt };
  try {
    await ctx.prisma.opsMemberLink.upsert({
      where: { discordUserId: link.discordUserId },
      create: { discordUserId: link.discordUserId, ...data },
      update: data,
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Fine only if a concurrent delivery already wrote this exact link; anything else is real.
    const row = await ctx.prisma.opsMemberLink.findUnique({
      where: { discordUserId: link.discordUserId },
    });
    if (row?.memberId !== link.memberId) throw error;
  }

  const member = await fetchMember(ctx, link.discordUserId);
  if (member && !member.roles.cache.has(layout.roles.verified)) {
    await member.roles.add(layout.roles.verified, `Verified member ${link.memberId}`);
  }
  if (isNew) {
    await recordVerificationEvent(ctx, {
      type: 'linked',
      discordUserId: link.discordUserId,
      memberId: link.memberId,
      detail: `via ${source}${link.accountRole ? ` · account role: ${link.accountRole}` : ''}`,
    });
    if (member) {
      await member
        .send({
          embeds: [
            arkhonEmbed({
              title: 'You are verified',
              description: [
                `Your Discord account is now linked to Arkhon member ID \`${link.memberId}\`.`,
                `The server is unlocked. Pick your products in <#${layout.channels.startHere}> to see the Certa and Argus channels.`,
                'You can unlink at any time from your account settings on arkhonindustries.com.',
              ].join('\n\n'),
            }),
          ],
        })
        .catch(() => undefined);
    }
  }
  return isNew;
}

/** Removes a link and the roles it unlocked (Verified and product roles). */
export async function removeMemberLink(
  ctx: OpsContext,
  discordUserId: string,
  options: {
    reason: string;
    source: LinkSource | 'staff';
    actorId?: string;
    notifyWebsite?: boolean;
  },
): Promise<boolean> {
  const layout = ctx.layout.require();
  const existing = await ctx.prisma.opsMemberLink.findUnique({ where: { discordUserId } });
  if (options.notifyWebsite && ctx.security.api) {
    await ctx.security.api.unlink(discordUserId).catch((error: unknown) => {
      ctx.logger.warn({ err: error, discordUserId }, 'website unlink failed');
    });
  }
  if (existing) await ctx.prisma.opsMemberLink.deleteMany({ where: { discordUserId } });

  const member = await fetchMember(ctx, discordUserId);
  if (member) {
    const roles = [layout.roles.verified, ...PRODUCTS.map((p) => layout.roles.user[p])].filter(
      (id) => member.roles.cache.has(id),
    );
    if (roles.length > 0)
      await member.roles.remove(roles, `Unlinked: ${options.reason}`).catch(() => undefined);
  }
  if (existing || member) {
    await recordVerificationEvent(ctx, {
      type: 'unlinked',
      discordUserId,
      ...(existing ? { memberId: existing.memberId } : {}),
      ...(options.actorId ? { actorId: options.actorId } : {}),
      detail: `${options.reason} (via ${options.source})`,
    });
  }
  return Boolean(existing);
}

export async function getMemberLink(ctx: OpsContext, discordUserId: string) {
  return ctx.prisma.opsMemberLink.findUnique({ where: { discordUserId } });
}

// ---------------------------------------------------------------- raid lockdown

let lockdownTimer: NodeJS.Timeout | undefined;

/** Starts (or extends) a lockdown: new verifications are refused and invites are paused. */
export async function startLockdown(
  ctx: OpsContext,
  guild: Guild,
  reason: string,
  options: { actorId?: string; minutes?: number } = {},
): Promise<Date> {
  const durationMs = (options.minutes ?? ctx.config.raid.lockdownMinutes) * 60_000;
  const until = new Date(ctx.security.raid.start(reason, Date.now(), durationMs));
  await guild
    .setIncidentActions({ invitesDisabledUntil: until })
    .catch((error: unknown) => ctx.logger.warn({ err: error }, 'could not pause invites'));
  if (lockdownTimer) clearTimeout(lockdownTimer);
  lockdownTimer = setTimeout(() => void endLockdown(ctx, guild, 'expired'), durationMs);
  lockdownTimer.unref();
  await recordVerificationEvent(ctx, {
    type: 'lockdown_on',
    detail: `${reason}. Invites paused and verification closed until <t:${Math.floor(until.getTime() / 1000)}:t>.`,
    ...(options.actorId ? { actorId: options.actorId } : {}),
  });
  return until;
}

export async function endLockdown(
  ctx: OpsContext,
  guild: Guild,
  reason: string,
  actorId?: string,
): Promise<void> {
  if (lockdownTimer) clearTimeout(lockdownTimer);
  lockdownTimer = undefined;
  const wasActive = ctx.security.raid.isLocked();
  ctx.security.raid.stop();
  await guild
    .setIncidentActions({ invitesDisabledUntil: null })
    .catch((error: unknown) => ctx.logger.warn({ err: error }, 'could not resume invites'));
  if (wasActive || actorId) {
    await recordVerificationEvent(ctx, {
      type: 'lockdown_off',
      detail: `Lockdown ended (${reason}).`,
      ...(actorId ? { actorId } : {}),
    });
  }
}

/** Counts joins and starts a lockdown on a spike. */
export async function onMemberJoinShield(ctx: OpsContext, member: GuildMember): Promise<void> {
  if (member.guild.id !== ctx.config.discord.guildId || member.user.bot) return;
  if (ctx.security.raid.recordJoin()) {
    await startLockdown(ctx, member.guild, `Join spike: ${ctx.security.raid.recentJoins()} joins`);
  }
}

/**
 * Product roles only make sense for verified members. If one is added to an unverified,
 * non-staff member (by hand, by Onboarding or by another bot), it is removed again.
 */
export async function guardProductRoles(
  ctx: OpsContext,
  before: GuildMember | PartialGuildMember,
  after: GuildMember,
): Promise<void> {
  const layout = ctx.layout.current;
  // Without verification configured there is no way to get Verified, so do not enforce it.
  if (
    !layout ||
    !ctx.security.api ||
    after.guild.id !== ctx.config.discord.guildId ||
    after.user.bot
  )
    return;
  if (after.roles.cache.has(layout.roles.verified) || isStaff(after, layout)) return;
  const productRoles = PRODUCTS.map((p) => layout.roles.user[p]);
  const held = productRoles.filter((id) => after.roles.cache.has(id));
  const gained = held.filter((id) => !before.roles?.cache.has(id));
  const lostVerified = Boolean(before.roles?.cache.has(layout.roles.verified));
  // Strip on gaining a product role while unverified, or on losing Verified while holding one.
  const toRemove = lostVerified ? held : gained;
  if (toRemove.length === 0) return;
  await after.roles.remove(toRemove, 'Product roles require verification').catch(() => undefined);
  await recordVerificationEvent(ctx, {
    type: 'role_stripped',
    discordUserId: after.id,
    detail: `Removed ${toRemove.map((id) => `<@&${id}>`).join(', ')} until the member verifies.`,
  });
}
