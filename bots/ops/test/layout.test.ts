import { UserFacingError } from '@arkhon/shared';
import { describe, expect, it } from 'vitest';
import { buildLayout, LayoutStore, mergeResourceIds, REQUIRED_RESOURCES } from '../src/layout.js';

const complete = Object.fromEntries(
  REQUIRED_RESOURCES.map((key, i) => [key, String(100000000000000000 + i)]),
);

describe('layout', () => {
  it('reports every missing required resource', () => {
    expect(buildLayout({}).missing).toEqual([...REQUIRED_RESOURCES]);
    const { missing } = buildLayout({ ...complete, 'channel.support': undefined });
    expect(missing).toEqual(['channel.support']);
  });

  it('builds the structured layout including optional roles', () => {
    const { layout } = buildLayout({ ...complete, 'role.team': '9', 'channel.welcome': '8' });
    expect(layout?.channels.support).toBe(complete['channel.support']);
    expect(layout?.channels.feedbackForum).toBe(complete['channel.feedback']);
    expect(layout?.channels.home.argus).toBe(complete['channel.argusGeneral']);
    expect(layout?.roles.user.certa).toBe(complete['role.certaUser']);
    expect(layout?.roles.team).toBe('9');
    expect(layout?.roles.moderator).toBeUndefined();
    expect(layout?.channels.welcome).toBe('8');
  });

  it('lets env overrides win over stored ids', () => {
    const { ids, sources } = mergeResourceIds(
      { 'channel.support': 'db', 'role.team': 'db' },
      { 'channel.support': 'env' },
    );
    expect(ids).toEqual({ 'channel.support': 'env', 'role.team': 'db' });
    expect(sources).toEqual({ 'channel.support': 'env', 'role.team': 'setup' });
  });

  it('store throws a user-facing error until set up, then serves the layout', () => {
    const store = new LayoutStore();
    store.apply({});
    expect(store.current).toBeUndefined();
    expect(() => store.require()).toThrow(UserFacingError);
    expect(() => store.require()).toThrow('/setup server');
    store.apply(complete);
    expect(store.require().channels.modLog).toBe(complete['channel.modLog']);
    expect(store.missing).toEqual([]);
  });
});
