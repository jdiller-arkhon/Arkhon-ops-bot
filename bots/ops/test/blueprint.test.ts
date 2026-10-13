import { PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { OPTIONAL_RESOURCES, REQUIRED_RESOURCES } from '../src/layout.js';
import {
  allChannels,
  BLUEPRINT,
  findChannel,
  grantedPermissions,
  mergeOverwrites,
} from '../src/setup/blueprint.js';
import { RULES } from '../src/setup/content.js';
import { resolveOverwrites } from '../src/setup/apply.js';

const roleKeys = new Set(BLUEPRINT.roles.map((r) => r.key));
const channelKeys = allChannels().map((c) => c.key);

describe('blueprint integrity', () => {
  it('has unique role, category and channel keys', () => {
    expect(roleKeys.size).toBe(BLUEPRINT.roles.length);
    const categoryKeys = BLUEPRINT.categories.map((c) => c.key);
    expect(new Set(categoryKeys).size).toBe(categoryKeys.length);
    expect(new Set(channelKeys).size).toBe(channelKeys.length);
  });

  it('defines every resource the bot features read', () => {
    for (const key of [...REQUIRED_RESOURCES, ...OPTIONAL_RESOURCES]) {
      const [kind, name] = key.split('.') as [string, string];
      if (kind === 'role') expect(roleKeys.has(name as never), key).toBe(true);
      else expect(channelKeys, key).toContain(name);
    }
  });

  it('uses the right channel kinds for features', () => {
    expect(findChannel('feedback')?.kind).toBe('forum');
    expect(findChannel('support')?.kind).toBe('text');
    expect(findChannel('announcements')?.kind).toBe('announcement');
    const tags = findChannel('feedback')?.forum?.tags.map((t) => t.name) ?? [];
    expect(tags).toEqual(expect.arrayContaining(['Certa', 'Argus']));
  });

  it('only uses real permission names', () => {
    const all = new Set<string>(grantedPermissions());
    for (const category of BLUEPRINT.categories) {
      for (const spec of [
        ...category.overwrites,
        ...category.channels.flatMap((c) => c.overwrites ?? []),
      ]) {
        spec.deny?.forEach((p) => all.add(p));
      }
    }
    for (const perm of all) expect(PermissionFlagsBits, perm).toHaveProperty(perm);
  });

  it('only references known roles and channels', () => {
    for (const category of BLUEPRINT.categories) {
      for (const spec of [
        ...category.overwrites,
        ...category.channels.flatMap((c) => c.overwrites ?? []),
      ]) {
        if (spec.principal !== 'everyone' && spec.principal !== 'bot') {
          expect(roleKeys.has(spec.principal)).toBe(true);
        }
      }
    }
    const { server, onboarding } = BLUEPRINT;
    for (const key of [server.publicUpdatesChannel, server.rulesChannel, server.systemChannel]) {
      expect(channelKeys).toContain(key);
    }
    for (const option of onboarding.options) {
      option.roles.forEach((role) => expect(roleKeys.has(role)).toBe(true));
      option.channels.forEach((channel) => expect(channelKeys).toContain(channel));
    }
  });

  it('respects Discord limits', () => {
    for (const role of BLUEPRINT.roles) expect(role.name.length).toBeLessThanOrEqual(100);
    for (const channel of allChannels()) {
      expect(channel.name.length).toBeLessThanOrEqual(100);
      expect((channel.topic ?? '').length).toBeLessThanOrEqual(1024);
      expect(channel.slowmodeSeconds ?? 0).toBeLessThanOrEqual(21600);
    }
    expect(BLUEPRINT.server.description.length).toBeLessThanOrEqual(120);
    expect(allChannels().length + BLUEPRINT.categories.length).toBeLessThan(500);
  });

  it('gates the server: unverified members see only welcome, rules and verify', () => {
    const visibleTo = (principal: 'everyone' | 'verified') =>
      allChannels()
        .filter((c) => {
          const merged = mergeOverwrites(c.category.overwrites, c.overwrites);
          const everyone = merged.find((o) => o.principal === 'everyone');
          const role = merged.find((o) => o.principal === principal);
          const everyoneSees = !everyone?.deny?.includes('ViewChannel');
          if (principal === 'everyone') return everyoneSees;
          if (role?.deny?.includes('ViewChannel')) return false;
          return everyoneSees || Boolean(role?.allow?.includes('ViewChannel'));
        })
        .map((c) => c.key);
    expect(visibleTo('everyone').sort()).toEqual(['rules', 'verify', 'welcome']);
    const verified = visibleTo('verified');
    expect(verified).not.toContain('verify');
    expect(verified).toEqual(
      expect.arrayContaining([
        'welcome',
        'rules',
        'startHere',
        'announcements',
        'general',
        'feedback',
        'support',
      ]),
    );
    // Product and staff channels need more than Verified.
    expect(verified).not.toContain('certaGeneral');
    expect(verified).not.toContain('staffLounge');
  });

  it('lets staff see #verify and keeps the Verified role lowest so product colors show', () => {
    const verify = findChannel('verify');
    const merged = mergeOverwrites(verify!.category.overwrites, verify!.overwrites);
    expect(merged.find((o) => o.principal === 'team')?.allow).toContain('ViewChannel');
    expect(BLUEPRINT.roles.at(-1)?.key).toBe('verified');
  });

  it('keeps product channels private to their roles', () => {
    for (const product of ['certa', 'argus'] as const) {
      const category = BLUEPRINT.categories.find((c) => c.key === product);
      const everyone = category?.overwrites.find((o) => o.principal === 'everyone');
      expect(everyone?.deny).toContain('ViewChannel');
      expect(
        category?.overwrites.some(
          (o) => o.principal === `${product}User` && o.allow?.includes('ViewChannel'),
        ),
      ).toBe(true);
    }
  });

  it('ships non-empty rules', () => {
    expect(RULES.length).toBeGreaterThanOrEqual(5);
    for (const rule of RULES) expect(rule.body.length).toBeGreaterThan(10);
  });
});

describe('resolved overwrites', () => {
  it('never send two overwrites for the same role or member', () => {
    const ids = {
      guildId: 'g',
      botId: 'b',
      roles: Object.fromEntries(BLUEPRINT.roles.map((r) => [r.key, `role-${r.key}`])),
    };
    for (const category of BLUEPRINT.categories) {
      const catIds = resolveOverwrites(mergeOverwrites(category.overwrites), ids).map((o) =>
        String(o.id),
      );
      expect(new Set(catIds).size, category.name).toBe(catIds.length);
      for (const channel of category.channels) {
        const chIds = resolveOverwrites(
          mergeOverwrites(category.overwrites, channel.overwrites),
          ids,
        ).map((o) => String(o.id));
        expect(new Set(chIds).size, channel.name).toBe(chIds.length);
      }
    }
  });
});

describe('mergeOverwrites', () => {
  it('lets channel overwrites flip category allows and denies per principal', () => {
    const merged = mergeOverwrites(
      [
        { principal: 'everyone', allow: ['ViewChannel'], deny: ['SendMessages'] },
        { principal: 'team', allow: ['SendMessages'] },
      ],
      [
        { principal: 'everyone', allow: ['SendMessages'] },
        { principal: 'team', deny: ['SendMessages'] },
        { principal: 'bot', allow: ['ManageThreads'] },
      ],
    );
    expect(merged).toEqual([
      { principal: 'everyone', allow: ['ViewChannel', 'SendMessages'], deny: [] },
      { principal: 'team', allow: [], deny: ['SendMessages'] },
      { principal: 'bot', allow: ['ManageThreads'], deny: [] },
    ]);
  });
});
