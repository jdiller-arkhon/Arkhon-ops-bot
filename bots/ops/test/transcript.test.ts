import { describe, expect, it } from 'vitest';
import { formatTranscript, type TranscriptMessage } from '../src/tickets/transcript.js';

const ticket = {
  id: 42,
  product: 'certa' as const,
  subject: 'Logbook export fails',
  description: 'Export to PDF hangs.\nTried twice.',
  appVersion: '2.4.1',
  userTag: 'pilot_amy',
  userId: '111111111111111111',
  createdAt: new Date('2026-03-01T10:00:00.000Z'),
  closedAt: new Date('2026-03-01T12:30:00.000Z'),
  closedByTag: 'staff_bob',
  claimedByTag: 'staff_bob',
};

const message = (minutes: number, overrides: Partial<TranscriptMessage>): TranscriptMessage => ({
  authorTag: 'pilot_amy',
  authorId: '111111111111111111',
  bot: false,
  createdAt: new Date(ticket.createdAt.getTime() + minutes * 60_000),
  content: '',
  attachments: [],
  embeds: [],
  ...overrides,
});

describe('formatTranscript', () => {
  it('includes ticket metadata and messages oldest first', () => {
    const text = formatTranscript(ticket, [
      message(20, { authorTag: 'staff_bob', content: 'Fixed in 2.4.2' }),
      message(1, {
        authorTag: 'Arkhon Ops',
        bot: true,
        embeds: ['Ticket #42: Logbook export fails'],
      }),
      message(5, {
        content: 'Here is a screenshot',
        attachments: ['https://cdn.example/shot.png'],
      }),
    ]);
    expect(text).toContain('Certa support ticket #42');
    expect(text).toContain('App version: 2.4.1');
    expect(text).toContain('Closed:      2026-03-01 12:30:00 UTC by staff_bob');
    expect(text).toContain('    Export to PDF hangs.\n    Tried twice.');
    expect(text).toContain('Messages (3)');

    const bot = text.indexOf('Arkhon Ops [bot]');
    const amy = text.indexOf('[2026-03-01 10:05:00 UTC] pilot_amy:');
    const bob = text.indexOf('staff_bob:\n    Fixed in 2.4.2');
    expect(bot).toBeGreaterThan(-1);
    expect(bot).toBeLessThan(amy);
    expect(amy).toBeLessThan(bob);
    expect(text).toContain('[attachment] https://cdn.example/shot.png');
    expect(text).toContain('[embed] Ticket #42: Logbook export fails');
  });

  it('marks messages without text and handles missing optional fields', () => {
    const text = formatTranscript({ ...ticket, appVersion: null, claimedByTag: null }, [
      message(1, {}),
    ]);
    expect(text).toContain('App version: not provided');
    expect(text).toContain('Claimed by:  unclaimed');
    expect(text).toContain('(no text content)');
  });
});
