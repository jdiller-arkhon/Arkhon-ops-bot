import { arkhonEmbed, PRODUCTS, productLabel } from '@arkhon/shared';
import type { EmbedBuilder } from 'discord.js';
import type { OpsContext } from '../context.js';
import { formatDuration, summarizeTimings } from './stats.js';

export async function buildTicketStatsEmbed(ctx: OpsContext, days: number): Promise<EmbedBuilder> {
  const since = new Date(Date.now() - days * 86_400_000);
  const [openGroups, recent] = await Promise.all([
    ctx.prisma.opsTicket.groupBy({
      by: ['product', 'status'],
      where: { status: { in: ['open', 'waiting'] }, channelId: { not: null } },
      _count: { _all: true },
    }),
    ctx.prisma.opsTicket.findMany({
      where: { createdAt: { gte: since }, channelId: { not: null } },
      select: { product: true, createdAt: true, firstStaffReplyAt: true, closedAt: true },
    }),
  ]);

  const count = (product: string, status: string) =>
    openGroups.find((g) => g.product === product && g.status === status)?._count._all ?? 0;

  const fields = PRODUCTS.map((product) => {
    const timings = summarizeTimings(recent.filter((t) => t.product === product));
    const open = count(product, 'open');
    const waiting = count(product, 'waiting');
    return {
      name: productLabel(product),
      value: [
        `**Open:** ${open + waiting} (${open} active, ${waiting} waiting on user)`,
        `**Median first staff reply:** ${formatDuration(timings.medianFirstReplyMs)} (${timings.repliedCount} tickets)`,
        `**Median time to close:** ${formatDuration(timings.medianCloseMs)} (${timings.closedCount} tickets)`,
        `**Opened in window:** ${recent.filter((t) => t.product === product).length}`,
      ].join('\n'),
    };
  });

  return arkhonEmbed({
    title: 'Support ticket stats',
    description: `Open counts are current. Medians cover tickets opened in the last ${days} day${days === 1 ? '' : 's'}.`,
    fields,
    timestamp: true,
  });
}
