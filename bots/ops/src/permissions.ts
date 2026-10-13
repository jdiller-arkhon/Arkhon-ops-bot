import { PRODUCTS, productLabel, UserFacingError, type Product } from '@arkhon/shared';
import { PermissionFlagsBits, type GuildMember, type Interaction } from 'discord.js';
import type { OpsConfig } from './config.js';
import type { OpsContext } from './context.js';
import type { ServerLayout } from './layout.js';

export function isAdmin(member: GuildMember): boolean {
  return (
    member.id === member.guild.ownerId || member.permissions.has(PermissionFlagsBits.Administrator)
  );
}

/**
 * Staff for a specific product, or for any product when `product` is omitted.
 * Admins and the Arkhon Team role always pass.
 */
export function isStaff(member: GuildMember, layout: ServerLayout, product?: Product): boolean {
  if (isAdmin(member)) return true;
  if (layout.roles.team && member.roles.cache.has(layout.roles.team)) return true;
  const products = product ? [product] : PRODUCTS;
  return products.some((p) => member.roles.cache.has(layout.roles.staff[p]));
}

/** Staff of any product, or the Moderator role. */
export function isModerator(member: GuildMember, layout: ServerLayout): boolean {
  if (isStaff(member, layout)) return true;
  return Boolean(layout.roles.moderator && member.roles.cache.has(layout.roles.moderator));
}

/** Narrows to a cached guild interaction in the configured guild, or throws a user-facing error. */
export function requireGuildMember(interaction: Interaction, config: OpsConfig): GuildMember {
  if (!interaction.inCachedGuild() || interaction.guildId !== config.discord.guildId) {
    throw new UserFacingError('This only works inside the Arkhon server.');
  }
  return interaction.member;
}

export function requireStaff(
  interaction: Interaction,
  ctx: OpsContext,
  product?: Product,
): GuildMember {
  const member = requireGuildMember(interaction, ctx.config);
  if (!isStaff(member, ctx.layout.require(), product)) {
    throw new UserFacingError(
      product ? `Only ${productLabel(product)} Staff can do that.` : 'Only staff can do that.',
    );
  }
  return member;
}

export function requireModerator(interaction: Interaction, ctx: OpsContext): GuildMember {
  const member = requireGuildMember(interaction, ctx.config);
  if (!isModerator(member, ctx.layout.require())) {
    throw new UserFacingError('Only staff and moderators can do that.');
  }
  return member;
}

export function requireAdmin(interaction: Interaction, ctx: OpsContext): GuildMember {
  const member = requireGuildMember(interaction, ctx.config);
  if (!isAdmin(member)) throw new UserFacingError('Only server administrators can do that.');
  return member;
}
