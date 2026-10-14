import { ActivityType, type Client, type Guild, type PresenceData } from 'discord.js';
import type { OpsContext } from './context.js';

/** Live numbers some status lines show. */
export interface PresenceStats {
  openTickets: number;
}

/** How often the custom status changes. Discord allows far more; slower reads better. */
export const PRESENCE_ROTATE_MS = 90_000;

/** Discord's limit for a custom status. */
const MAX_STATUS_LENGTH = 128;

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** The rotation, in order. Each line is a custom status (shown under the bot's name). */
export const STATUS_LINES: readonly ((stats: PresenceStats) => string)[] = [
  () => '🛡️ Standing watch over The Arkhon Pilot Network',
  ({ openTickets }) =>
    openTickets === 0
      ? '✅ All channels clear · /ticket if you need us'
      : `🎫 ${plural(openTickets, 'ticket', 'tickets')} in the queue · /ticket for help`,
  () => '✈️ Certa · Argus · cleared for flight',
  () => '🔐 New here? Link your member ID in #verify',
];

/** The presence for rotation step `step` (wraps around the list). */
export function presenceFor(step: number, stats: PresenceStats): PresenceData {
  const index = ((step % STATUS_LINES.length) + STATUS_LINES.length) % STATUS_LINES.length;
  const state = STATUS_LINES[index]!(stats).slice(0, MAX_STATUS_LENGTH);
  return {
    status: 'online',
    activities: [{ type: ActivityType.Custom, name: 'Custom Status', state }],
  };
}

async function readStats(ctx: OpsContext, guild: Guild): Promise<PresenceStats> {
  const openTickets = await ctx.prisma.opsTicket
    .count({ where: { guildId: guild.id, status: { not: 'closed' } } })
    .catch(() => 0);
  return { openTickets };
}

/** Sets the custom status now and rotates it every PRESENCE_ROTATE_MS. */
export function startPresenceRotation(client: Client<true>, ctx: OpsContext, guild: Guild): void {
  let step = 0;
  const update = async () => {
    try {
      client.user.setPresence(presenceFor(step++, await readStats(ctx, guild)));
    } catch (error) {
      ctx.logger.warn({ err: error }, 'could not update presence');
    }
  };
  void update();
  setInterval(() => void update(), PRESENCE_ROTATE_MS).unref();
}
