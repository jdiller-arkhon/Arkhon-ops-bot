import { describe, expect, it } from 'vitest';
import { computeTotals, rankLeaderboard } from '../src/domain/mock-math.js';

describe('computeTotals', () => {
  it('sums rolling windows that include today', () => {
    const rows = [
      { date: '2026-10-09', durationMinutes: 30 },
      { date: '2026-09-10', durationMinutes: 20 }, // day 30
      { date: '2026-09-09', durationMinutes: 10 }, // day 31
      { date: '2025-01-01', durationMinutes: 60 },
    ];
    expect(computeTotals(rows, '2026-10-09')).toEqual({
      totalFlights: 4,
      totalMinutes: 120,
      last30Days: { flights: 2, minutes: 50 },
      last90Days: { flights: 3, minutes: 60 },
      last365Days: { flights: 3, minutes: 60 },
    });
  });
});

describe('rankLeaderboard', () => {
  const names = new Map([
    ['a', 'Ava'],
    ['b', 'Ben'],
  ]);
  const rows = [
    { certaUserId: 'a', date: '2026-10-02', durationMinutes: 30 },
    { certaUserId: 'b', date: '2026-10-03', durationMinutes: 45 },
    { certaUserId: 'a', date: '2026-09-30', durationMinutes: 200 },
  ];

  it('ranks by minutes within a month', () => {
    expect(rankLeaderboard(rows, names, { month: '2026-10', limit: 10 })).toEqual([
      { rank: 1, certaUserId: 'b', displayName: 'Ben', totalMinutes: 45, flightCount: 1 },
      { rank: 2, certaUserId: 'a', displayName: 'Ava', totalMinutes: 30, flightCount: 1 },
    ]);
  });

  it('covers all time and respects the limit', () => {
    expect(rankLeaderboard(rows, names, { limit: 1 })).toEqual([
      { rank: 1, certaUserId: 'a', displayName: 'Ava', totalMinutes: 230, flightCount: 2 },
    ]);
  });
});
