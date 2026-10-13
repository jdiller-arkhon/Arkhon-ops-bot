import { UserFacingError, type Product } from '@arkhon/shared';
import type { PrismaClient } from '@prisma/client';

/**
 * The server layout: which Discord channel/role ids the bot's features use.
 *
 * Ids come from two places, env overrides first, then the ids /setup server stored in the
 * ops_server_resources table. Every resource the blueprint creates is stored under a key like
 * "channel.support" or "role.certaStaff"; the keys listed here are the ones features read.
 */
export const REQUIRED_RESOURCES = [
  'channel.startHere',
  'channel.announcements',
  'channel.support',
  'channel.ticketArchive',
  'channel.modLog',
  'channel.feedback',
  'channel.certaGeneral',
  'channel.argusGeneral',
  'role.certaStaff',
  'role.argusStaff',
  'role.certaUser',
  'role.argusUser',
] as const;

export const OPTIONAL_RESOURCES = [
  'channel.welcome',
  'channel.rules',
  'channel.general',
  'role.team',
  'role.moderator',
] as const;

export type RequiredResourceKey = (typeof REQUIRED_RESOURCES)[number];
export type OptionalResourceKey = (typeof OPTIONAL_RESOURCES)[number];
/** Any stored resource key. Blueprint-only resources (e.g. "channel.showcase") are plain strings. */
export type ResourceKey =
  RequiredResourceKey | OptionalResourceKey | `${'role' | 'category' | 'channel'}.${string}`;

export type ResourceSource = 'env' | 'setup';

export interface ServerLayout {
  channels: {
    startHere: string;
    announcements: string;
    support: string;
    ticketArchive: string;
    modLog: string;
    feedbackForum: string;
    home: Record<Product, string>;
    welcome?: string;
    rules?: string;
    general?: string;
  };
  roles: {
    staff: Record<Product, string>;
    user: Record<Product, string>;
    /** Company team: staff for every product. */
    team?: string;
    /** Community moderators: may use /mod but do not handle tickets. */
    moderator?: string;
  };
}

export type ResourceIds = Partial<Record<string, string>>;

/** Builds a complete layout from resolved ids, or reports which required keys are missing. */
export function buildLayout(ids: ResourceIds): {
  layout?: ServerLayout;
  missing: RequiredResourceKey[];
} {
  const missing = REQUIRED_RESOURCES.filter((key) => !ids[key]);
  if (missing.length > 0) return { missing };
  const req = (key: RequiredResourceKey) => ids[key] as string;
  const opt = (key: OptionalResourceKey) => (ids[key] ? { value: ids[key] } : undefined);
  const layout: ServerLayout = {
    channels: {
      startHere: req('channel.startHere'),
      announcements: req('channel.announcements'),
      support: req('channel.support'),
      ticketArchive: req('channel.ticketArchive'),
      modLog: req('channel.modLog'),
      feedbackForum: req('channel.feedback'),
      home: { certa: req('channel.certaGeneral'), argus: req('channel.argusGeneral') },
    },
    roles: {
      staff: { certa: req('role.certaStaff'), argus: req('role.argusStaff') },
      user: { certa: req('role.certaUser'), argus: req('role.argusUser') },
    },
  };
  const welcome = opt('channel.welcome');
  const rules = opt('channel.rules');
  const general = opt('channel.general');
  const team = opt('role.team');
  const moderator = opt('role.moderator');
  if (welcome) layout.channels.welcome = welcome.value;
  if (rules) layout.channels.rules = rules.value;
  if (general) layout.channels.general = general.value;
  if (team) layout.roles.team = team.value;
  if (moderator) layout.roles.moderator = moderator.value;
  return { layout, missing: [] };
}

/** Env overrides win over ids stored by /setup. */
export function mergeResourceIds(
  stored: ResourceIds,
  overrides: ResourceIds,
): { ids: ResourceIds; sources: Record<string, ResourceSource> } {
  const ids: ResourceIds = { ...stored };
  const sources: Record<string, ResourceSource> = {};
  for (const key of Object.keys(stored)) sources[key] = 'setup';
  for (const [key, value] of Object.entries(overrides)) {
    if (!value) continue;
    ids[key] = value;
    sources[key] = 'env';
  }
  return { ids, sources };
}

export const NOT_SET_UP_MESSAGE =
  'This server has not been set up yet. A server admin needs to run `/setup server` first.';

/** Holds the live layout. Reloaded after /setup server without restarting the bot. */
export class LayoutStore {
  private layout: ServerLayout | undefined;
  private resolved: ResourceIds = {};
  private resolvedSources: Record<string, ResourceSource> = {};
  private missingKeys: RequiredResourceKey[] = [...REQUIRED_RESOURCES];

  constructor(private readonly overrides: ResourceIds = {}) {}

  get current(): ServerLayout | undefined {
    return this.layout;
  }

  get missing(): readonly RequiredResourceKey[] {
    return this.missingKeys;
  }

  get ids(): Readonly<ResourceIds> {
    return this.resolved;
  }

  get sources(): Readonly<Record<string, ResourceSource>> {
    return this.resolvedSources;
  }

  /** The layout, or a user-facing error telling an admin to run /setup server. */
  require(): ServerLayout {
    if (!this.layout) throw new UserFacingError(NOT_SET_UP_MESSAGE);
    return this.layout;
  }

  apply(stored: ResourceIds): void {
    const { ids, sources } = mergeResourceIds(stored, this.overrides);
    const { layout, missing } = buildLayout(ids);
    this.resolved = ids;
    this.resolvedSources = sources;
    this.layout = layout;
    this.missingKeys = missing;
  }

  async load(prisma: PrismaClient): Promise<void> {
    const rows = await prisma.opsServerResource.findMany();
    this.apply(Object.fromEntries(rows.map((row) => [row.key, row.discordId])));
  }
}
