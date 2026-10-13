import { arkhonEmbed, EMBED_LIMITS, productLabel } from '@arkhon/shared';
import { ChannelType } from 'discord.js';
import type { OpsContext } from '../context.js';
import { isUniqueViolation } from '../db.js';
import { displayVersion, type Release } from './payload.js';

export type AnnounceResult = { status: 'posted'; messageId: string } | { status: 'duplicate' };

export function formatNotes(notes: string, url?: string): string {
  const trimmed = notes.trim() || '_No release notes provided._';
  const more = url ? `\n\n… [Read the full notes](${url})` : '\n\n… (truncated)';
  if (trimmed.length <= EMBED_LIMITS.description) return trimmed;
  return trimmed.slice(0, EMBED_LIMITS.description - more.length) + more;
}

/**
 * Posts a release embed to #announcements, pinging only the matching product role.
 * Each product/version is announced at most once (webhook retries are ignored).
 */
export async function announceRelease(ctx: OpsContext, release: Release): Promise<AnnounceResult> {
  try {
    await ctx.prisma.opsRelease.create({
      data: { product: release.product, version: release.version, source: release.source },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { status: 'duplicate' };
    throw error;
  }

  try {
    const layout = ctx.layout.require();
    const channel = await ctx.client.channels.fetch(layout.channels.announcements);
    if (!channel?.isSendable() || channel.isDMBased()) {
      throw new Error('ANNOUNCEMENTS_CHANNEL_ID is not a channel the bot can post in');
    }
    const label = productLabel(release.product);
    const version = displayVersion(release.version);
    const roleId = layout.roles.user[release.product];
    const embed = arkhonEmbed({
      product: release.product,
      title: `${label} ${version}${release.title ? ` — ${release.title}` : ''}${release.prerelease ? ' (pre-release)' : ''}`,
      description: formatNotes(release.notes, release.url),
      timestamp: true,
      ...(release.url ? { url: release.url } : {}),
    });
    const message = await channel.send({
      content: `<@&${roleId}> ${label} ${version} is out!`,
      embeds: [embed],
      allowedMentions: { roles: [roleId] },
    });
    if (channel.type === ChannelType.GuildAnnouncement) {
      await message.crosspost().catch((error: unknown) => {
        ctx.logger.warn({ err: error }, 'could not publish announcement to followers');
      });
    }
    await ctx.prisma.opsRelease.update({
      where: { product_version: { product: release.product, version: release.version } },
      data: { messageId: message.id },
    });
    ctx.logger.info(
      { product: release.product, version: release.version, source: release.source },
      'release announced',
    );
    return { status: 'posted', messageId: message.id };
  } catch (error) {
    // Allow a retry to post it.
    await ctx.prisma.opsRelease
      .delete({
        where: { product_version: { product: release.product, version: release.version } },
      })
      .catch(() => undefined);
    throw error;
  }
}
