import { EmbedBuilder, type APIEmbedField } from 'discord.js';
import { productLabel, type Product } from './products.js';

/** The single Arkhon brand color used on every embed. */
export const BRAND_COLOR = 0x1d4ed8;

export const BRAND_NAME = 'Arkhon Industries';

export interface ArkhonEmbedOptions {
  title?: string;
  description?: string;
  /** Product shown in the footer. Omit for server-wide messages. */
  product?: Product;
  fields?: APIEmbedField[];
  url?: string;
  timestamp?: Date | number | boolean;
}

export const EMBED_LIMITS = {
  title: 256,
  description: 4096,
  fieldValue: 1024,
  fieldName: 256,
} as const;

export function truncate(text: string, max: number, suffix = '…'): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - suffix.length)) + suffix;
}

export function footerText(product?: Product): string {
  return product ? `${BRAND_NAME} · ${productLabel(product)}` : BRAND_NAME;
}

/** Builds an embed in the house style: brand color, footer with the product name. */
export function arkhonEmbed(options: ArkhonEmbedOptions = {}): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setFooter({ text: footerText(options.product) });
  if (options.title) embed.setTitle(truncate(options.title, EMBED_LIMITS.title));
  if (options.description) {
    embed.setDescription(truncate(options.description, EMBED_LIMITS.description));
  }
  if (options.url) embed.setURL(options.url);
  if (options.fields?.length) {
    embed.addFields(
      options.fields.map((field) => ({
        ...field,
        name: truncate(field.name, EMBED_LIMITS.fieldName),
        value: truncate(field.value, EMBED_LIMITS.fieldValue),
      })),
    );
  }
  if (options.timestamp === true) embed.setTimestamp();
  else if (options.timestamp) embed.setTimestamp(options.timestamp);
  return embed;
}
