import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { mergeChannels } from '../src/channels.js';
import { normalizeLinkCode } from '../src/commands/certa.js';
import { fitsCustomId, ids, parseCustomId } from '../src/ids.js';
import { dueRunKey } from '../src/jobs/scheduler.js';

describe('dueRunKey', () => {
  const at = (iso: string) => DateTime.fromISO(iso, { zone: 'America/Denver' });
  it('is due daily from the configured time onward', () => {
    expect(dueRunKey({ kind: 'daily', time: '06:30' }, at('2026-10-09T06:29'))).toBeNull();
    expect(dueRunKey({ kind: 'daily', time: '06:30' }, at('2026-10-09T06:30'))).toBe('2026-10-09');
    expect(dueRunKey({ kind: 'daily', time: '06:30' }, at('2026-10-09T23:59'))).toBe('2026-10-09');
  });
  it('is due monthly only on the configured day', () => {
    const s = { kind: 'monthly', day: 1, time: '09:00' } as const;
    expect(dueRunKey(s, at('2026-11-01T08:59'))).toBeNull();
    expect(dueRunKey(s, at('2026-11-01T09:00'))).toBe('2026-11');
    expect(dueRunKey(s, at('2026-11-02T09:00'))).toBeNull();
  });
});

describe('custom ids', () => {
  it('round-trips and keeps colons inside the argument', () => {
    expect(parseCustomId(ids.logModal('Inspection'))).toEqual({
      feature: 'log',
      action: 'modal',
      arg: 'Inspection',
    });
    expect(parseCustomId('certa:log:share:a:b')).toEqual({
      feature: 'log',
      action: 'share',
      arg: 'a:b',
    });
    expect(parseCustomId('ops:ticket:claim:1')).toBeUndefined();
    expect(fitsCustomId(ids.logShare('x'.repeat(90)))).toBe(false);
  });
});

describe('channels', () => {
  it('prefers env overrides over the ids /setup server stored', () => {
    expect(
      mergeChannels(
        { 'channel.certaFlightLogs': '1', 'channel.certaGeneral': '2' },
        { flightLogs: undefined, preflight: undefined, home: '9' },
      ),
    ).toEqual({ flightLogs: '1', home: '9' });
  });
});

describe('normalizeLinkCode', () => {
  it('uppercases and strips spaces, rejecting malformed codes', () => {
    expect(normalizeLinkCode(' abc 123 ')).toBe('ABC123');
    expect(normalizeLinkCode('ab')).toBeUndefined();
    expect(normalizeLinkCode('abc$123')).toBeUndefined();
  });
});
