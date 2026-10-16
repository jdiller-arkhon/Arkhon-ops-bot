import { DateTime } from 'luxon';
import type { FlightTotals, LeaderboardEntry, PeriodTotals } from '../certa/types.js';

/** The fields of a logged flight that totals and leaderboards use. */
export interface FlightRow {
  certaUserId: string;
  date: string;
  durationMinutes: number;
}

/**
 * Flight totals as of `today` (YYYY-MM-DD, the pilot's local date). "Last 30 days" includes today
 * and the 29 days before it.
 */
export function computeTotals(
  rows: readonly Pick<FlightRow, 'date' | 'durationMinutes'>[],
  today: string,
): FlightTotals {
  const day = DateTime.fromISO(today, { zone: 'utc' });
  const since = (days: number): PeriodTotals => {
    const from = day.minus({ days: days - 1 }).toISODate()!;
    const recent = rows.filter((row) => row.date >= from && row.date <= today);
    return {
      flights: recent.length,
      minutes: recent.reduce((sum, row) => sum + row.durationMinutes, 0),
    };
  };
  return {
    totalFlights: rows.length,
    totalMinutes: rows.reduce((sum, row) => sum + row.durationMinutes, 0),
    last30Days: since(30),
    last90Days: since(90),
    last365Days: since(365),
  };
}

/**
 * Top pilots by flight time. Ties break by more flights, then display name. `month` (YYYY-MM)
 * limits the board to that calendar month.
 */
export function rankLeaderboard(
  rows: readonly FlightRow[],
  displayNames: ReadonlyMap<string, string>,
  options: { month?: string; limit: number },
): LeaderboardEntry[] {
  const totals = new Map<string, { totalMinutes: number; flightCount: number }>();
  for (const row of rows) {
    if (options.month && !row.date.startsWith(`${options.month}-`)) continue;
    const entry = totals.get(row.certaUserId) ?? { totalMinutes: 0, flightCount: 0 };
    entry.totalMinutes += row.durationMinutes;
    entry.flightCount += 1;
    totals.set(row.certaUserId, entry);
  }
  return [...totals.entries()]
    .map(([certaUserId, t]) => ({
      certaUserId,
      displayName: displayNames.get(certaUserId) ?? certaUserId,
      ...t,
    }))
    .sort(
      (a, b) =>
        b.totalMinutes - a.totalMinutes ||
        b.flightCount - a.flightCount ||
        a.displayName.localeCompare(b.displayName),
    )
    .slice(0, options.limit)
    .map((entry, index) => ({ rank: index + 1, ...entry }));
}
