import type { BaseMessageOptions, Client } from 'discord.js';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from '@arkhon/shared';

export type PanelKey = 'support' | 'roles';

/**
 * Keeps exactly one panel message alive per key. On startup: if the stored message still exists
 * in the configured channel it is edited to the latest content, otherwise a new one is posted and
 * its id stored. Panel buttons route by custom id, so they keep working across restarts.
 */
export async function ensurePanel(
  deps: { client: Client; prisma: PrismaClient; logger: Logger },
  key: PanelKey,
  channelId: string,
  payload: BaseMessageOptions,
): Promise<void> {
  const { client, prisma, logger } = deps;
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || channel.isDMBased() || !('send' in channel)) {
    throw new Error(`Panel channel ${channelId} for "${key}" is missing or not a text channel`);
  }

  const existing = await prisma.opsPanel.findUnique({ where: { key } });
  if (existing && existing.channelId === channelId) {
    const message = await channel.messages.fetch(existing.messageId).catch(() => null);
    if (message) {
      await message.edit(payload);
      logger.info({ panel: key, messageId: message.id }, 'panel refreshed');
      return;
    }
  }

  const message = await channel.send(payload);
  await prisma.opsPanel.upsert({
    where: { key },
    create: { key, channelId, messageId: message.id },
    update: { channelId, messageId: message.id },
  });
  logger.info({ panel: key, messageId: message.id, channelId }, 'panel posted');
}
