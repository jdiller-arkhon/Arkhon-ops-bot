import { ChannelType, OverwriteType, PermissionsBitField } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { missingBotPermissions, mergeForumTags, resolveOverwrites } from '../src/setup/apply.js';
import { allChannels, BLUEPRINT } from '../src/setup/blueprint.js';
import {
  normalizeName,
  planBuildout,
  summarizePlan,
  type GuildSnapshot,
} from '../src/setup/plan.js';

const empty: GuildSnapshot = { roles: [], channels: [], stored: {}, community: false };
const totalChannels = allChannels().length;

describe('planBuildout', () => {
  it('creates everything on an empty server', () => {
    const plan = planBuildout(empty);
    expect(summarizePlan(plan)).toEqual({
      role: { create: BLUEPRINT.roles.length, update: 0, skip: 0 },
      category: { create: BLUEPRINT.categories.length, update: 0, skip: 0 },
      channel: { create: totalChannels, update: 0, skip: 0 },
    });
    expect(plan.items.find((i) => i.key === 'channel.officeHours')?.note).toMatch(/Community/);
    expect(plan.items.find((i) => i.key === 'channel.announcements')?.note).toMatch(/Announcement/);
  });

  it('adopts existing roles and channels by name, ignoring emoji and case differences', () => {
    const plan = planBuildout({
      ...empty,
      community: true,
      roles: [
        { id: 'r1', name: 'certa staff', managed: false, editable: true },
        { id: 'r2', name: 'Arkhon Team', managed: false, editable: false },
        { id: 'r3', name: 'Moderator', managed: true, editable: false },
      ],
      channels: [
        { id: 'c1', name: 'SUPPORT', type: ChannelType.GuildCategory, parentId: null },
        { id: 'c2', name: '🎫・support', type: ChannelType.GuildText, parentId: 'c1' },
        { id: 'c3', name: '📣・announcements', type: ChannelType.GuildText, parentId: null },
        { id: 'c4', name: '💡・feedback', type: ChannelType.GuildText, parentId: null },
      ],
    });
    const byKey = Object.fromEntries(plan.items.map((i) => [i.key, i]));
    expect(byKey['role.certaStaff']).toMatchObject({ action: 'update', existingId: 'r1' });
    expect(byKey['role.team']).toMatchObject({ action: 'skip', existingId: 'r2' });
    expect(byKey['role.moderator']).toMatchObject({ action: 'create' }); // managed roles are never adopted
    expect(byKey['category.support']).toMatchObject({ action: 'update', existingId: 'c1' });
    expect(byKey['channel.support']).toMatchObject({ action: 'update', existingId: 'c2' });
    expect(byKey['channel.announcements']).toMatchObject({ action: 'update', existingId: 'c3' });
    // A text channel named like the forum is not a forum: create a real one.
    expect(byKey['channel.feedback']).toMatchObject({ action: 'create' });
  });

  it('prefers stored ids over names, so renamed channels are still matched', () => {
    const plan = planBuildout({
      ...empty,
      stored: { 'channel.general': 'c9', 'role.certaUser': 'r9' },
      roles: [{ id: 'r9', name: 'Certa Pilots', managed: false, editable: true }],
      channels: [
        { id: 'c9', name: 'chat', type: ChannelType.GuildText, parentId: null },
        { id: 'c10', name: '💬・general', type: ChannelType.GuildText, parentId: null },
      ],
    });
    const byKey = Object.fromEntries(plan.items.map((i) => [i.key, i]));
    expect(byKey['channel.general']).toMatchObject({ action: 'update', existingId: 'c9' });
    expect(byKey['role.certaUser']).toMatchObject({ action: 'update', existingId: 'r9' });
  });

  it('never assigns one existing channel to two blueprint entries', () => {
    const plan = planBuildout({
      ...empty,
      channels: [{ id: 'c1', name: '🧭・certa-help', type: ChannelType.GuildText, parentId: null }],
    });
    const adopted = plan.items.filter((i) => i.existingId === 'c1');
    expect(adopted).toHaveLength(1);
    expect(adopted[0]?.key).toBe('channel.certaHelp');
  });

  it('is idempotent: a fully built server plans only updates', () => {
    const stored: Record<string, string> = {};
    const roles: GuildSnapshot['roles'] = [];
    const channels: GuildSnapshot['channels'] = [];
    BLUEPRINT.roles.forEach((role, i) => {
      stored[`role.${role.key}`] = `r${i}`;
      roles.push({ id: `r${i}`, name: role.name, managed: false, editable: true });
    });
    BLUEPRINT.categories.forEach((category, i) => {
      stored[`category.${category.key}`] = `k${i}`;
      channels.push({
        id: `k${i}`,
        name: category.name,
        type: ChannelType.GuildCategory,
        parentId: null,
      });
      category.channels.forEach((channel, j) => {
        const type = {
          text: ChannelType.GuildText,
          announcement: ChannelType.GuildAnnouncement,
          forum: ChannelType.GuildForum,
          voice: ChannelType.GuildVoice,
          stage: ChannelType.GuildStageVoice,
        }[channel.kind];
        stored[`channel.${channel.key}`] = `c${i}-${j}`;
        channels.push({ id: `c${i}-${j}`, name: channel.name, type, parentId: `k${i}` });
      });
    });
    const plan = planBuildout({ roles, channels, stored, community: true });
    expect(plan.items.every((i) => i.action === 'update')).toBe(true);
  });
});

describe('normalizeName', () => {
  it('ignores case, spaces and emoji variation selectors', () => {
    expect(normalizeName('🛩️・Certa General')).toBe(normalizeName('🛩・certa-general'));
  });
});

describe('resolveOverwrites', () => {
  it('maps principals to ids and drops unknown roles and empty specs', () => {
    expect(
      resolveOverwrites(
        [
          { principal: 'everyone', deny: ['ViewChannel'] },
          { principal: 'bot', allow: ['SendMessages'] },
          { principal: 'certaUser', allow: ['ViewChannel'] },
          { principal: 'argusUser', allow: ['ViewChannel'] },
          { principal: 'team', allow: [], deny: [] },
        ],
        { guildId: 'g', botId: 'b', roles: { certaUser: 'r1', team: 'r2' } },
      ),
    ).toEqual([
      { id: 'g', type: OverwriteType.Role, allow: [], deny: ['ViewChannel'] },
      { id: 'b', type: OverwriteType.Member, allow: ['SendMessages'], deny: [] },
      { id: 'r1', type: OverwriteType.Role, allow: ['ViewChannel'], deny: [] },
    ]);
  });
});

describe('missingBotPermissions', () => {
  it('is satisfied by Administrator', () => {
    expect(missingBotPermissions(new PermissionsBitField(['Administrator']))).toEqual([]);
  });

  it('lists management and granted permissions the bot lacks', () => {
    const missing = missingBotPermissions(new PermissionsBitField(['ViewChannel', 'SendMessages']));
    expect(missing).toEqual(
      expect.arrayContaining(['ManageRoles', 'ManageChannels', 'ManageGuild', 'ModerateMembers']),
    );
    expect(missing).not.toContain('SendMessages');
  });
});

describe('mergeForumTags', () => {
  it('keeps existing tags and adds missing blueprint tags', () => {
    const tags = mergeForumTags(
      [{ id: 't1', name: 'certa', moderated: false, emoji: null }],
      [
        { name: 'Certa', emoji: '🛩️' },
        { name: 'Bug', emoji: '🐞' },
      ],
    );
    expect(tags.map((t) => t.name)).toEqual(['certa', 'Bug']);
    expect(tags[0]?.id).toBe('t1');
  });
});
