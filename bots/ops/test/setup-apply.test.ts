import { createLogger } from '@arkhon/shared';
import {
  ChannelFlagsBitField,
  ChannelType,
  Collection,
  GuildFeature,
  PermissionsBitField,
  type Guild,
} from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { loadOpsConfig } from '../src/config.js';
import type { OpsContext } from '../src/context.js';
import { LayoutStore } from '../src/layout.js';
import { executeBuildout, snapshotGuild, type BuildOptions } from '../src/setup/apply.js';
import { allChannels, BLUEPRINT } from '../src/setup/blueprint.js';
import { planBuildout } from '../src/setup/plan.js';
import { styleName } from '../src/setup/fonts.js';
import { CHANNEL_NAME_STYLE } from '../src/setup/blueprint.js';
import { validOpsEnv } from './fixtures.js';

const styled = (name: string) => styleName(name, CHANNEL_NAME_STYLE);

vi.mock('../src/startup.js', () => ({ runLayoutTasks: vi.fn(async () => []) }));

const ALL: BuildOptions = { serverSettings: true, community: true, onboarding: true };

interface FakeChannel {
  id: string;
  name: string;
  type: ChannelType;
  parentId: string | null;
  topic?: string;
  flags: Readonly<ChannelFlagsBitField>;
  availableTags: { id?: string; name: string }[];
  permissionOverwrites?: unknown[];
}

/** Just enough of a discord.js Guild for the executor, backed by maps. */
function fakeGuild(opts: { allowCommunity?: boolean; roleIcons?: boolean } = {}) {
  let next = 1000;
  const newId = () => String(next++);
  const roles = new Map<
    string,
    { id: string; name: string; managed: boolean; position: number; icon: string | null }
  >();
  const iconUploads: string[] = [];
  const channels = new Map<string, FakeChannel>();
  // The bot itself (999), another bot and a human; role ids per member.
  const memberRoles = new Map<string, Set<string>>([
    ['999', new Set()],
    ['777', new Set()],
    ['555', new Set()],
  ]);
  const fakeMember = (id: string) => ({
    id,
    user: { bot: id !== '555' },
    roles: {
      cache: { has: (roleId: string) => memberRoles.get(id)!.has(roleId) },
      add: async (roleId: string) => void memberRoles.get(id)!.add(roleId),
    },
  });
  const calls = {
    onboarding: [] as unknown[],
    edits: [] as Record<string, unknown>[],
    everyonePerms: 0,
  };
  const guild = {
    id: '1',
    features: (opts.roleIcons ? ['ROLE_ICONS'] : []) as string[],
    members: {
      fetch: async () => new Collection([...memberRoles.keys()].map((id) => [id, fakeMember(id)])),
      fetchMe: async () => ({
        id: '999',
        permissions: new PermissionsBitField(['Administrator']),
        roles: { highest: { position: 50, comparePositionTo: () => 1 } },
      }),
    },
    roles: {
      everyone: { setPermissions: async () => void calls.everyonePerms++ },
      fetch: async () => new Collection([...roles]),
      create: async (data: { name: string }) => {
        const role = {
          id: newId(),
          name: data.name,
          managed: false,
          position: 1,
          icon: null as string | null,
        };
        roles.set(role.id, role);
        return role;
      },
      edit: async (id: string, data: { name?: string; icon?: Buffer }) => {
        const role = roles.get(id)!;
        if (data.name) role.name = data.name;
        if (data.icon) {
          role.icon = 'hash';
          iconUploads.push(role.name);
        }
        return role;
      },
      setPositions: async () => guild,
    },
    channels: {
      fetch: async (id?: string) =>
        id ? (channels.get(id) ?? null) : new Collection([...channels]),
      create: async (
        data: Partial<FakeChannel> & { name: string; type: ChannelType; parent?: string | null },
      ) => {
        if (
          data.type === ChannelType.GuildStageVoice &&
          !guild.features.includes(GuildFeature.Community)
        ) {
          throw new Error('stage needs community');
        }
        const channel: FakeChannel = {
          id: newId(),
          name: data.name,
          type: data.type,
          parentId: data.parent ?? null,
          topic: data.topic,
          flags: new ChannelFlagsBitField(),
          availableTags: (data.availableTags as { name: string }[] | undefined) ?? [],
          permissionOverwrites: data.permissionOverwrites as unknown[],
        };
        channels.set(channel.id, channel);
        return channel;
      },
      edit: async (target: string | FakeChannel, data: Record<string, unknown>) => {
        const channel = channels.get(typeof target === 'string' ? target : target.id)!;
        if (typeof data.name === 'string') channel.name = data.name;
        if (typeof data.type === 'number') channel.type = data.type;
        if (Array.isArray(data.flags))
          channel.flags = new ChannelFlagsBitField(data.flags as never);
        if ('parent' in data) channel.parentId = (data.parent as string | null) ?? null;
        return channel;
      },
      setPositions: async () => guild,
    },
    edit: async (data: Record<string, unknown>) => {
      calls.edits.push(data);
      if (Array.isArray(data.features) && opts.allowCommunity !== false)
        guild.features = [...data.features];
      return guild;
    },
    fetch: async () => guild,
    fetchOnboarding: async () => ({ prompts: new Collection() }),
    editOnboarding: async (data: unknown) => void calls.onboarding.push(data),
  };
  return {
    guild: guild as unknown as Guild,
    roles,
    channels,
    calls,
    raw: guild,
    iconUploads,
    memberRoles,
  };
}

function fakeContext() {
  const rows = new Map<string, { key: string; kind: string; discordId: string }>();
  const prisma = {
    opsServerResource: {
      findMany: async () => [...rows.values()],
      upsert: async ({ create }: { create: { key: string; kind: string; discordId: string } }) => {
        rows.set(create.key, create);
        return create;
      },
    },
  };
  const ctx = {
    config: loadOpsConfig({
      DISCORD_TOKEN: validOpsEnv.DISCORD_TOKEN!,
      DISCORD_CLIENT_ID: validOpsEnv.DISCORD_CLIENT_ID!,
      DISCORD_GUILD_ID: validOpsEnv.DISCORD_GUILD_ID!,
      DATABASE_URL: 'file:./x.db',
      RELEASE_WEBHOOK_SECRET: validOpsEnv.RELEASE_WEBHOOK_SECRET!,
    }),
    logger: createLogger('test', { level: 'silent' }),
    prisma,
    layout: new LayoutStore(),
    client: {},
  } as unknown as OpsContext;
  return { ctx, rows };
}

async function build(fake: ReturnType<typeof fakeGuild>, ctx: OpsContext, options = ALL) {
  const plan = planBuildout(await snapshotGuild(ctx, fake.guild));
  return executeBuildout(ctx, fake.guild, plan, options, async () => undefined);
}

describe('executeBuildout (in-memory guild)', () => {
  const totalChannels = allChannels().length;

  it('builds the whole blueprint, enables Community and makes the layout ready', async () => {
    const fake = fakeGuild();
    const { ctx, rows } = fakeContext();
    const report = await build(fake, ctx);

    expect(report.warnings).toEqual([]);
    expect(fake.roles.size).toBe(BLUEPRINT.roles.length);
    expect(fake.channels.size).toBe(BLUEPRINT.categories.length + totalChannels);
    expect(report.created).toHaveLength(
      BLUEPRINT.roles.length + BLUEPRINT.categories.length + totalChannels,
    );
    expect(rows.size).toBe(BLUEPRINT.roles.length + BLUEPRINT.categories.length + totalChannels);
    expect(ctx.layout.current).toBeDefined();
    expect(fake.raw.features).toContain(GuildFeature.Community);

    // Every bot (not the human) wears the Arkhon Systems role, which sits at the top of the list.
    const botsRole = [...fake.roles.values()].find((r) => r.name === 'Arkhon Systems');
    expect(botsRole).toBeDefined();
    expect(BLUEPRINT.roles[0]?.key).toBe('bots');
    expect(fake.memberRoles.get('999')?.has(botsRole!.id)).toBe(true);
    expect(fake.memberRoles.get('777')?.has(botsRole!.id)).toBe(true);
    expect(fake.memberRoles.get('555')?.has(botsRole!.id)).toBe(false);
    expect(report.updated).toContain('Arkhon Systems → 2 bots');

    const byName = (name: string) => [...fake.channels.values()].find((c) => c.name === name);
    expect(byName(styled('📣・announcements'))?.type).toBe(ChannelType.GuildAnnouncement);
    expect(byName(styled('🎙️ Office Hours'))?.type).toBe(ChannelType.GuildStageVoice);
    const forum = byName(styled('💡・feedback'));
    expect(forum?.type).toBe(ChannelType.GuildForum);
    expect(forum?.flags.has('RequireTag')).toBe(true);
    expect(forum?.availableTags.map((t) => t.name)).toEqual(
      expect.arrayContaining(['Certa', 'Argus']),
    );
    const supportCategory = [...fake.channels.values()].find((c) => c.name === 'SUPPORT');
    expect(byName(styled('🎫・support'))?.parentId).toBe(supportCategory?.id);

    expect(fake.calls.everyonePerms).toBe(1);
    expect(fake.calls.onboarding).toHaveLength(1);
    const onboarding = fake.calls.onboarding[0] as {
      enabled: boolean;
      defaultChannels: string[];
      prompts: { options: { roles: string[] }[] }[];
    };
    expect(onboarding.enabled).toBe(true);
    expect(onboarding.defaultChannels.length).toBeGreaterThanOrEqual(7);
    expect(onboarding.prompts[0]?.options.every((o) => o.roles.length === 1)).toBe(true);
  });

  it('is idempotent: a second run creates nothing', async () => {
    const fake = fakeGuild();
    const { ctx } = fakeContext();
    await build(fake, ctx);
    const before = fake.channels.size + fake.roles.size;
    const report = await build(fake, ctx);
    expect(report.created).toEqual([]);
    expect(fake.channels.size + fake.roles.size).toBe(before);
    expect(report.updated.some((u) => u.startsWith('Arkhon Systems →'))).toBe(false);
    expect(report.warnings).toEqual([]);
  });

  it('degrades gracefully when Community cannot be enabled', async () => {
    const fake = fakeGuild({ allowCommunity: false });
    const { ctx } = fakeContext();
    const report = await build(fake, ctx);
    expect(report.warnings.some((w) => w.startsWith('Community'))).toBe(true);
    expect(report.skipped).toEqual(
      expect.arrayContaining([
        `${styled('🎙️ Office Hours')} (needs Community)`,
        'Onboarding (needs Community)',
      ]),
    );
    const announcements = [...fake.channels.values()].find(
      (c) => c.name === styled('📣・announcements'),
    );
    expect(announcements?.type).toBe(ChannelType.GuildText);
    expect(ctx.layout.current).toBeDefined(); // features still work without Community
  });

  it('uploads custom role icons once when the server has Role Icons (Boost Level 2)', async () => {
    const fake = fakeGuild({ roleIcons: true });
    const { ctx } = fakeContext();
    const report = await build(fake, ctx);
    expect(fake.iconUploads).toHaveLength(BLUEPRINT.roles.length);
    expect(report.skipped.some((s) => s.startsWith('Role icons'))).toBe(false);
    await build(fake, ctx); // second run keeps the icons it already set
    expect(fake.iconUploads).toHaveLength(BLUEPRINT.roles.length);
  });

  it('skips role icons without Boost Level 2 and says so', async () => {
    const fake = fakeGuild();
    const { ctx } = fakeContext();
    const report = await build(fake, ctx);
    expect(fake.iconUploads).toHaveLength(0);
    expect(report.skipped).toContain('Role icons (need Boost Level 2; re-run after boosting)');
  });

  it('respects disabled options', async () => {
    const fake = fakeGuild();
    const { ctx } = fakeContext();
    await build(fake, ctx, { serverSettings: false, community: false, onboarding: false });
    expect(fake.calls.everyonePerms).toBe(0);
    expect(fake.calls.onboarding).toHaveLength(0);
    expect(fake.calls.edits).toHaveLength(0);
  });
});
