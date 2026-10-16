import { createLogger } from '@arkhon/shared';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import type { CurrencyStatus } from '../src/certa/types.js';
import { REMINDER_THRESHOLDS, selectReminder } from '../src/domain/reminders.js';
import { previousMonth, runRecurrentReminders } from '../src/jobs/index.js';
import type { Link, ReminderStore } from '../src/store.js';

const logger = createLogger('test', { level: 'silent' });

describe('selectReminder', () => {
  it('uses the 60/30/14/3 day thresholds', () => {
    expect(REMINDER_THRESHOLDS).toEqual([60, 30, 14, 3]);
  });

  it('sends nothing before the first threshold or after lapsing', () => {
    expect(selectReminder(61, [])).toBeNull();
    expect(selectReminder(-1, [])).toBeNull();
  });

  it('fires on each threshold once', () => {
    expect(selectReminder(60, [])).toEqual({ threshold: 60, markSent: [60] });
    expect(selectReminder(59, [60])).toBeNull();
    expect(selectReminder(30, [60])).toEqual({ threshold: 30, markSent: [30] });
    expect(selectReminder(3, [60, 30, 14])).toEqual({ threshold: 3, markSent: [3] });
    expect(selectReminder(0, [60, 30, 14, 3])).toBeNull();
  });

  it('sends only the most urgent reached threshold and marks the skipped ones', () => {
    expect(selectReminder(10, [])).toEqual({ threshold: 14, markSent: [60, 30, 14] });
  });

  it('emits exactly four reminders over a daily countdown', () => {
    const sent: number[] = [];
    const fired: number[] = [];
    for (let days = 90; days >= -5; days--) {
      const decision = selectReminder(days, sent);
      if (decision) {
        fired.push(days);
        sent.push(...decision.markSent);
      }
    }
    expect(fired).toEqual([60, 30, 14, 3]);
  });
});

/** In-memory ReminderStore for the job. */
function memoryStore(links: Link[]): ReminderStore & { sends: Set<string> } {
  const sends = new Set<string>();
  return {
    sends,
    listRemindable: async () => links.filter((l) => l.remindersEnabled),
    sentReminderThresholds: async (user, due) =>
      [...sends].filter((k) => k.startsWith(`${user}|${due}|`)).map((k) => Number(k.split('|')[2])),
    recordRemindersSent: async (user, due, thresholds) => {
      for (const t of thresholds) sends.add(`${user}|${due}|${t}`);
    },
  };
}

const link = (id: string, remindersEnabled = true): Link => ({
  discordUserId: id,
  certaUserId: `c-${id}`,
  displayName: `Pilot ${id}`,
  remindersEnabled,
});

describe('runRecurrentReminders', () => {
  // Training 2024-11-20 -> current through 2026-11-30.
  const currency = async (): Promise<CurrencyStatus> => ({
    lastTrainingDate: '2024-11-20',
    lastTrainingKind: 'recurrent',
  });

  it('DMs on each threshold day only, even when run twice a day', async () => {
    const store = memoryStore([link('1')]);
    const days: string[] = [];
    let day = DateTime.fromISO('2026-09-21');
    for (let i = 0; i < 80; i++) {
      for (let run = 0; run < 2; run++) {
        await runRecurrentReminders({
          store,
          certa: { getCurrency: currency },
          today: day.toISODate()!,
          logger,
          send: async () => {
            days.push(day.toISODate()!);
            return true;
          },
        });
      }
      day = day.plus({ days: 1 });
    }
    expect(days).toEqual(['2026-10-01', '2026-10-31', '2026-11-16', '2026-11-27']);
  });

  it('skips opted-out pilots and retries when a DM fails', async () => {
    const store = memoryStore([link('1'), link('2', false)]);
    const deps = { store, certa: { getCurrency: currency }, today: '2026-10-02', logger };
    expect(await runRecurrentReminders({ ...deps, send: async () => false })).toEqual({
      checked: 1,
      sent: 0,
      failed: 1,
    });
    expect(await runRecurrentReminders({ ...deps, send: async () => true })).toEqual({
      checked: 1,
      sent: 1,
      failed: 0,
    });
    expect(await runRecurrentReminders({ ...deps, send: async () => true })).toMatchObject({
      sent: 0,
    });
  });

  it('counts a failing Certa lookup without stopping the run', async () => {
    const store = memoryStore([link('1'), link('2')]);
    let calls = 0;
    const result = await runRecurrentReminders({
      store,
      certa: {
        getCurrency: async () => {
          if (calls++ === 0) throw new Error('down');
          return currency();
        },
      },
      today: '2026-10-02',
      logger,
      send: async () => true,
    });
    expect(result).toEqual({ checked: 2, sent: 1, failed: 1 });
  });
});

describe('previousMonth', () => {
  it('names the month that just ended', () => {
    expect(previousMonth(DateTime.fromISO('2026-11-01T09:00'))).toBe('2026-10');
    expect(previousMonth(DateTime.fromISO('2027-01-01T09:00'))).toBe('2026-12');
  });
});
