import { PRODUCTS, UserFacingError, type Product } from '@arkhon/shared';
import {
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Interaction,
} from 'discord.js';
import type { OpsConfig } from './config.js';

export function isAdmin(member: GuildMember): boolean {
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

/** Staff for a specific product, or for any product when `product` is omitted. Admins always pass. */
export function isStaff(member: GuildMember, config: OpsConfig, product?: Product): boolean {
  if (isAdmin(member)) return true;
  const products = product ? [product] : PRODUCTS;
  return products.some((p) => member.roles.cache.has(config.roles.staff[p]));
}

/** Products the member is staff for (all of them for admins). */
export function staffProducts(member: GuildMember, config: OpsConfig): Product[] {
  if (isAdmin(member)) return [...PRODUCTS];
  return PRODUCTS.filter((p) => member.roles.cache.has(config.roles.staff[p]));
}

/** Narrows to a cached guild interaction in the configured guild, or throws a user-facing error. */
export function requireGuildMember(interaction: Interaction, config: OpsConfig): GuildMember {
  if (!interaction.inCachedGuild() || interaction.guildId !== config.discord.guildId) {
    throw new UserFacingError('This only works inside the Arkhon server.');
  }
  return interaction.member;
}

export function requireStaff(
  interaction: Interaction | ChatInputCommandInteraction,
  config: OpsConfig,
  product?: Product,
): GuildMember {
  const member = requireGuildMember(interaction, config);
  if (!isStaff(member, config, product)) {
    throw new UserFacingError(
      product
        ? `Only ${product === 'certa' ? 'Certa' : 'Argus'} Staff can do that.`
        : 'Only staff can do that.',
    );
  }
  return member;
}
