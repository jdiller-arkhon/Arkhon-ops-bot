import { createLogger } from '@arkhon/shared';
import { vi } from 'vitest';
import { loadOpsConfig } from '../src/config.js';
import type { OpsContext } from '../src/context.js';
import type { CommunityApi } from '../src/verification/api.js';
import { AttemptLimiter, RaidShield } from '../src/verification/shield.js';
import { fixtureLayout, validOpsEnv } from './fixtures.js';

export const WEBHOOK_SECRET = 'member-webhook-secret-0123456789abcdef';
export const API_TOKEN = 'community-api-token-0123456789abcdef';

export interface FakeMember {
  id: string;
  user: { id: string; username: string; tag: string; bot: boolean; createdTimestamp: number };
  roles: {
    cache: Set<string> & { has(id: string): boolean };
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  permissions: { has: () => boolean };
  guild: { id: string; ownerId: string };
  send: ReturnType<typeof vi.fn>;
}

export function fakeMember(id: string, roles: string[] = []): FakeMember {
  const cache = new Set(roles);
  return {
    id,
    user: {
      id,
      username: `user${id.slice(-3)}`,
      tag: `user${id.slice(-3)}`,
      bot: false,
      createdTimestamp: 0,
    },
    roles: {
      cache,
      add: vi.fn(async (ids: string | string[]) => [ids].flat().forEach((r) => cache.add(r))),
      remove: vi.fn(async (ids: string | string[]) => [ids].flat().forEach((r) => cache.delete(r))),
    },
    permissions: { has: () => false },
    guild: { id: validOpsEnv.DISCORD_GUILD_ID!, ownerId: '1' },
    send: vi.fn(async () => undefined),
  };
}

/** OpsContext backed by in-memory tables and a fake guild. */
export function fakeVerificationContext(options: { api?: Partial<CommunityApi> } = {}) {
  const links = new Map<
    string,
    { discordUserId: string; memberId: string; accountRole: string | null; linkedAt: Date }
  >();
  const events: {
    type: string;
    discordUserId: string | null;
    memberId: string | null;
    detail: string | null;
  }[] = [];
  const webhookIds = new Set<string>();
  const members = new Map<string, FakeMember>();
  const modLog = vi.fn(async () => undefined);
  const unique = () => Object.assign(new Error('unique'), { code: 'P2002' });

  const prisma = {
    opsMemberLink: {
      findUnique: async ({ where }: { where: { discordUserId?: string; memberId?: string } }) =>
        where.discordUserId
          ? (links.get(where.discordUserId) ?? null)
          : ([...links.values()].find((l) => l.memberId === where.memberId) ?? null),
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { discordUserId: string };
        create: never;
        update: object;
      }) => {
        const existing = links.get(where.discordUserId);
        const next = existing
          ? { ...existing, ...update }
          : (create as unknown as typeof existing & object);
        const clash = [...links.values()].find(
          (l) => l.memberId === next.memberId && l.discordUserId !== where.discordUserId,
        );
        if (clash) throw unique();
        links.set(where.discordUserId, next);
        return next;
      },
      delete: async ({ where }: { where: { discordUserId: string } }) => {
        const row = links.get(where.discordUserId);
        links.delete(where.discordUserId);
        return row;
      },
      count: async () => links.size,
    },
    opsVerificationEvent: {
      create: async ({ data }: { data: (typeof events)[number] }) => {
        events.push(data);
        return data;
      },
    },
    opsWebhookEvent: {
      create: async ({ data }: { data: { id: string } }) => {
        if (webhookIds.has(data.id)) throw unique();
        webhookIds.add(data.id);
        return data;
      },
    },
  };

  const guild = {
    id: validOpsEnv.DISCORD_GUILD_ID,
    members: {
      fetch: async (id: string) => members.get(id) ?? Promise.reject(new Error('Unknown Member')),
    },
    setIncidentActions: vi.fn(async () => ({})),
  };
  const client = {
    isReady: () => true,
    guilds: { fetch: async () => guild },
    channels: { fetch: async () => ({ isSendable: () => true, send: modLog }) },
  };
  const config = loadOpsConfig({
    ...validOpsEnv,
    ARKHON_WEBSITE_URL: 'https://arkhon.test',
    ARKHON_COMMUNITY_API_TOKEN: API_TOKEN,
    MEMBER_WEBHOOK_SECRET: WEBHOOK_SECRET,
  });
  const layout = fixtureLayout();
  const ctx = {
    config,
    logger: createLogger('test', { level: 'silent' }),
    prisma,
    client,
    layout,
    security: {
      api: options.api as CommunityApi | undefined,
      attempts: new AttemptLimiter(config.verification.maxAttemptsPerHour, 3_600_000),
      raid: new RaidShield(
        config.raid.joinThreshold,
        config.raid.windowSeconds * 1000,
        config.raid.lockdownMinutes * 60_000,
      ),
    },
  } as unknown as OpsContext;
  return { ctx, links, events, members, guild, modLog, roles: layout.require().roles };
}
