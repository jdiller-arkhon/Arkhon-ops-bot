import { ActivityType } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { STATUS_LINES, presenceFor } from '../src/presence.js';

const stats = { members: 1234, openTickets: 3 };

function state(step: number, s = stats): string {
  const activity = presenceFor(step, s).activities![0]!;
  expect(activity.type).toBe(ActivityType.Custom);
  return activity.state!;
}

describe('presence', () => {
  it('rotates through every line and wraps around', () => {
    const all = STATUS_LINES.map((_, i) => state(i));
    expect(new Set(all).size).toBe(STATUS_LINES.length);
    expect(state(STATUS_LINES.length)).toBe(all[0]);
    expect(state(-1)).toBe(all[STATUS_LINES.length - 1]);
  });

  it('shows live member and ticket counts', () => {
    const all = STATUS_LINES.map((_, i) => state(i));
    expect(all).toContain('🛰️ Guarding 1,234 pilots');
    expect(all).toContain('🎫 3 tickets in the queue · /ticket for help');
    const quiet = STATUS_LINES.map((_, i) => state(i, { members: 1, openTickets: 0 }));
    expect(quiet).toContain('🛰️ Guarding 1 pilot');
    expect(quiet).toContain('✅ All channels clear · /ticket if you need us');
  });

  it('stays within Discord limits and online', () => {
    for (let i = 0; i < STATUS_LINES.length; i++) {
      expect(state(i, { members: 10 ** 9, openTickets: 10 ** 9 }).length).toBeLessThanOrEqual(128);
      expect(presenceFor(i, stats).status).toBe('online');
    }
  });
});
