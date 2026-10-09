import { describe, expect, it } from 'vitest';
import {
  canTransition,
  InvalidTransitionError,
  nextStatus,
  TICKET_ACTIONS,
  TICKET_STATUSES,
  type TicketAction,
  type TicketStatus,
} from '../src/tickets/state.js';

describe('ticket state machine', () => {
  const allowed: [TicketStatus, TicketAction, TicketStatus][] = [
    ['open', 'claim', 'open'],
    ['open', 'markWaiting', 'waiting'],
    ['open', 'userReply', 'open'],
    ['open', 'close', 'closed'],
    ['waiting', 'claim', 'waiting'],
    ['waiting', 'userReply', 'open'],
    ['waiting', 'close', 'closed'],
  ];

  it.each(allowed)('%s --%s--> %s', (from, action, to) => {
    expect(canTransition(from, action)).toBe(true);
    expect(nextStatus(from, action)).toBe(to);
  });

  it('rejects marking a waiting ticket as waiting again', () => {
    expect(canTransition('waiting', 'markWaiting')).toBe(false);
    expect(() => nextStatus('waiting', 'markWaiting')).toThrow('already waiting on the user');
  });

  it.each(TICKET_ACTIONS)('closed is terminal (%s)', (action) => {
    expect(canTransition('closed', action)).toBe(false);
    expect(() => nextStatus('closed', action)).toThrow(InvalidTransitionError);
    expect(() => nextStatus('closed', action)).toThrow('already closed');
  });

  it('covers every status/action pair exactly as documented', () => {
    const allowedKeys = new Set(allowed.map(([from, action]) => `${from}:${action}`));
    for (const status of TICKET_STATUSES) {
      for (const action of TICKET_ACTIONS) {
        expect(canTransition(status, action)).toBe(allowedKeys.has(`${status}:${action}`));
      }
    }
  });

  it('exposes the failed transition on the error', () => {
    try {
      nextStatus('closed', 'claim');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTransitionError);
      expect((error as InvalidTransitionError).from).toBe('closed');
      expect((error as InvalidTransitionError).action).toBe('claim');
    }
  });

  it('supports a full lifecycle', () => {
    let status: TicketStatus = 'open';
    for (const action of ['claim', 'markWaiting', 'userReply', 'markWaiting', 'close'] as const) {
      status = nextStatus(status, action);
    }
    expect(status).toBe('closed');
  });
});
