import { describe, expect, it } from 'vitest';
import { formatDuration, median, summarizeTimings } from '../src/tickets/stats.js';

describe('median', () => {
  it('handles empty, odd and even lists without mutating input', () => {
    const input = [5, 1, 3, 2];
    expect(median([])).toBeUndefined();
    expect(median([7])).toBe(7);
    expect(median([3, 1, 2])).toBe(2);
    expect(median(input)).toBe(2.5);
    expect(input).toEqual([5, 1, 3, 2]);
  });
});

describe('formatDuration', () => {
  it.each([
    [undefined, 'n/a'],
    [500, '<1s'],
    [45_000, '45s'],
    [93_000, '1m 33s'],
    [3_600_000, '1h'],
    [3_660_000, '1h 1m'],
    [90_000_000, '1d 1h'],
    [86_400_000 + 30_000, '1d'],
  ])('%s -> %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe('summarizeTimings', () => {
  const t0 = new Date('2026-01-01T00:00:00Z');
  const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

  it('computes medians only over tickets that reached each milestone', () => {
    const summary = summarizeTimings([
      { createdAt: t0, firstStaffReplyAt: at(10), closedAt: at(60) },
      { createdAt: t0, firstStaffReplyAt: at(30), closedAt: null },
      { createdAt: t0, firstStaffReplyAt: null, closedAt: at(120) },
      { createdAt: t0, firstStaffReplyAt: null, closedAt: null },
    ]);
    expect(summary).toEqual({
      medianFirstReplyMs: 20 * 60_000,
      medianCloseMs: 90 * 60_000,
      repliedCount: 2,
      closedCount: 2,
    });
  });
});
