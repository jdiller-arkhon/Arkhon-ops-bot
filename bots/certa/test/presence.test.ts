import { describe, expect, it } from 'vitest';
import { presenceFor, STATUS_LINES, type PresenceStats } from '../src/presence.js';

const full: PresenceStats = {
  wx: { icao: 'KDEN', level: 'GO', windKt: 8, gustKt: null, reason: null },
  kp: 2.33,
  month: 'October',
  flightsThisMonth: 42,
  leader: { name: 'Maverick', minutes: 754 },
  linkedPilots: 17,
};
const empty: PresenceStats = {
  wx: null,
  kp: null,
  month: 'October',
  flightsThisMonth: null,
  leader: null,
  linkedPilots: null,
};
const state = (step: number, stats: PresenceStats) => {
  const activity = presenceFor(step, stats).presence.activities?.[0];
  return activity && 'state' in activity ? activity.state : undefined;
};

describe('presence', () => {
  it('shows every line in order when all data is there', () => {
    const lines = STATUS_LINES.map((_, i) => state(i, full));
    expect(lines).toEqual([
      '🛩️ On station for The Arkhon Pilot Network',
      '🟢 KDEN GO · wind 8 kt · /preflight',
      '📒 42 flights logged in October · /log yours',
      '🛰️ Kp 2.33 · GPS skies quiet',
      '🏆 Maverick leads October with 13 h · /leaderboard',
      '🧭 Part 107 current? Check with /currency',
      '👨‍✈️ 17 pilots linked · /certa link to join',
    ]);
  });

  it('shows caution, gusts and storms', () => {
    const stats: PresenceStats = {
      ...full,
      wx: {
        icao: 'KAPA',
        level: 'CAUTION',
        windKt: 18,
        gustKt: 27,
        reason: 'Gusts 27 kt exceed 20 kt',
      },
      kp: 6,
    };
    expect(state(1, stats)).toBe('🟡 KAPA CAUTION · Gusts 27 kt exceed 20 kt · /preflight');
    expect(state(3, stats)).toBe('⚠️ Kp 6 · geomagnetic storm, GPS may wander');
    expect(state(1, { ...stats, wx: { ...stats.wx!, reason: null } })).toBe(
      '🟡 KAPA CAUTION · wind 18G27 kt · /preflight',
    );
  });

  it('skips lines without data and wraps around', () => {
    expect(state(1, empty)).toBe('🧭 Part 107 current? Check with /currency');
    expect(presenceFor(1, empty).next).toBe(6);
    expect(state(6, empty)).toBe('🛩️ On station for The Arkhon Pilot Network');
    expect(state(2, { ...empty, flightsThisMonth: 0 })).toBe(
      '📒 First flight of October is up for grabs · /log',
    );
  });

  it('is a custom status', () => {
    const { presence } = presenceFor(0, full);
    expect(presence.status).toBe('online');
    expect(presence.activities?.[0]).toMatchObject({ type: 4, name: 'Custom Status' });
  });
});
