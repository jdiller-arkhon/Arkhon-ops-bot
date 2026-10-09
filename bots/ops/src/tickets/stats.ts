/** Median of a list of numbers; undefined for an empty list. */
export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** 93_000 -> "1m 33s", 90_000_000 -> "1d 1h". Shows the largest unit and the one below it. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return 'n/a';
  if (ms < 1000) return '<1s';
  const units: [string, number][] = [
    ['d', 86_400_000],
    ['h', 3_600_000],
    ['m', 60_000],
    ['s', 1000],
  ];
  const total = Math.round(ms);
  const first = units.findIndex(([, size]) => total >= size);
  const [bigLabel, bigSize] = units[first] as [string, number];
  const big = Math.floor(total / bigSize);
  const parts = [`${big}${bigLabel}`];
  const next = units[first + 1];
  if (next) {
    const small = Math.floor((total - big * bigSize) / next[1]);
    if (small > 0) parts.push(`${small}${next[0]}`);
  }
  return parts.join(' ');
}

export interface TicketTimes {
  createdAt: Date;
  firstStaffReplyAt: Date | null;
  closedAt: Date | null;
}

export interface TicketTimingSummary {
  medianFirstReplyMs: number | undefined;
  medianCloseMs: number | undefined;
  repliedCount: number;
  closedCount: number;
}

export function summarizeTimings(tickets: readonly TicketTimes[]): TicketTimingSummary {
  const firstReply = tickets
    .filter((t) => t.firstStaffReplyAt)
    .map((t) => (t.firstStaffReplyAt as Date).getTime() - t.createdAt.getTime());
  const close = tickets
    .filter((t) => t.closedAt)
    .map((t) => (t.closedAt as Date).getTime() - t.createdAt.getTime());
  return {
    medianFirstReplyMs: median(firstReply),
    medianCloseMs: median(close),
    repliedCount: firstReply.length,
    closedCount: close.length,
  };
}
