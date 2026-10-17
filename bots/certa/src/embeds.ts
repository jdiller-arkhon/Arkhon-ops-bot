import { arkhonEmbed } from '@arkhon/shared';
import type { EmbedBuilder } from 'discord.js';
import { DateTime } from 'luxon';
import type { FlightTotals, LeaderboardEntry, MissionType } from './certa/types.js';
import type { CurrencySummary } from './domain/currency.js';
import { formatDuration, formatHours } from './domain/flight.js';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const longDate = (iso: string) => DateTime.fromISO(iso).toFormat('LLL d, yyyy');

export function totalsEmbed(displayName: string, totals: FlightTotals): EmbedBuilder {
  const period = (name: string, p: { flights: number; minutes: number }) => ({
    name,
    value: `${plural(p.flights, 'flight')}\n${formatHours(p.minutes)} (${formatDuration(p.minutes)})`,
    inline: true,
  });
  return arkhonEmbed({
    title: `Flight time: ${displayName}`,
    description: `**${plural(totals.totalFlights, 'flight')}** · **${formatHours(totals.totalMinutes)}** total flight time`,
    product: 'certa',
    fields: [
      period('Last 30 days', totals.last30Days),
      period('Last 90 days', totals.last90Days),
      period('Last 365 days', totals.last365Days),
    ],
  });
}

/** Status line for a currency summary; emoji carry the state (embeds keep the brand color). */
export function currencyStatusLine(summary: CurrencySummary): string {
  const days = summary.daysRemaining ?? 0;
  switch (summary.state) {
    case 'lapsed':
      return (
        `🔴 **Lapsed**: recurrent training was due ${plural(Math.abs(days), 'day')} ago. ` +
        'Complete recurrent training before operating under Part 107.'
      );
    case 'due-soon':
      return `🟡 **Due soon**: ${days === 0 ? 'due **today**' : `**${plural(days, 'day')}** remaining`}`;
    case 'current':
      return `🟢 **Current**: **${plural(days, 'day')}** remaining`;
    default:
      return (
        'No Part 107 knowledge test or recurrent training is on file in Certa. Add your most ' +
        'recent training in the Certa app to track your due date.'
      );
  }
}

export function currencyEmbed(displayName: string, summary: CurrencySummary): EmbedBuilder {
  const title = `Part 107 recurrent training: ${displayName}`;
  if (!summary.dueDate || summary.daysRemaining === null || !summary.lastTrainingDate) {
    return arkhonEmbed({ title, description: currencyStatusLine(summary), product: 'certa' });
  }
  const kind =
    summary.lastTrainingKind === 'initial' ? 'initial knowledge test' : 'recurrent training';
  return arkhonEmbed({
    title,
    description:
      `${currencyStatusLine(summary)}\n\n` +
      '-# Recurrent training is due every 24 calendar months (14 CFR 107.65).',
    product: 'certa',
    fields: [
      { name: 'Due date', value: longDate(summary.dueDate), inline: true },
      { name: 'Days remaining', value: String(Math.max(summary.daysRemaining, 0)), inline: true },
      { name: `Last ${kind}`, value: longDate(summary.lastTrainingDate), inline: true },
    ],
  });
}

/** Linked pilots appear as mentions (the client never pings them), others by Certa name. */
export function leaderboardEmbed(
  title: string,
  entries: readonly LeaderboardEntry[],
  discordIdsByCertaId: ReadonlyMap<string, string>,
): EmbedBuilder {
  const medals = ['🥇', '🥈', '🥉'];
  const lines = entries.slice(0, 10).map((entry) => {
    const discordId = discordIdsByCertaId.get(entry.certaUserId);
    const who = discordId ? `<@${discordId}>` : entry.displayName;
    const badge = medals[entry.rank - 1] ?? `**${entry.rank}.**`;
    return `${badge} ${who}: ${formatHours(entry.totalMinutes)} · ${plural(entry.flightCount, 'flight')}`;
  });
  return arkhonEmbed({
    title,
    description:
      lines.length > 0 ? lines.join('\n') : 'No flights logged yet. Be the first with `/log`!',
    product: 'certa',
  });
}

export interface FlightSummary {
  date: string;
  location: string;
  aircraft: string;
  durationMinutes: number;
  missionType: MissionType;
}

export function flightEmbed(title: string, flight: FlightSummary): EmbedBuilder {
  return arkhonEmbed({
    title,
    product: 'certa',
    fields: [
      { name: 'Date', value: flight.date, inline: true },
      { name: 'Duration', value: formatDuration(flight.durationMinutes), inline: true },
      { name: 'Mission', value: flight.missionType, inline: true },
      { name: 'Location', value: flight.location, inline: true },
      { name: 'Aircraft', value: flight.aircraft, inline: true },
    ],
  });
}
