import { ChannelType } from 'discord.js';
import { foldStyledName } from './fonts.js';
import { allChannels, BLUEPRINT, type Blueprint, type ChannelKind } from './blueprint.js';

/** What exists in the guild right now, reduced to what the planner needs. */
export interface GuildSnapshot {
  roles: { id: string; name: string; managed: boolean; editable: boolean }[];
  channels: { id: string; name: string; type: ChannelType; parentId: string | null }[];
  /** Ids stored by previous /setup runs, keyed by resource key. */
  stored: Record<string, string>;
  community: boolean;
  /** Boost Level 2 "Role Icons" feature. */
  roleIcons?: boolean;
}

export type ResourceKind = 'role' | 'category' | 'channel';

export interface PlanItem {
  key: string; // e.g. "role.team", "category.info", "channel.support"
  kind: ResourceKind;
  name: string;
  action: 'create' | 'update' | 'skip';
  existingId?: string;
  /** Why an item is skipped, or a caveat about how it will be built. */
  note?: string;
}

/** A channel or category in the server that no blueprint resource matched. */
export interface UnmanagedChannel {
  id: string;
  name: string;
  type: ChannelType;
}

export interface BuildPlan {
  items: PlanItem[];
  /** Channels and categories outside the blueprint. Reported in the preview, never touched. */
  unmanaged: UnmanagedChannel[];
  community: boolean;
  roleIcons: boolean;
}

/**
 * Discord normalizes channel names (lowercase, dashes); compare loosely so renamed copies match.
 * Small-caps lettering is folded to ASCII, so switching CHANNEL_NAME_STYLE still matches by name.
 */
export function normalizeName(name: string): string {
  return foldStyledName(name)
    .normalize('NFKC')
    .replace(/️/g, '')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .trim();
}

/** Channel types that can stand in for a blueprint kind (text and announcement convert freely). */
export function compatibleTypes(kind: ChannelKind | 'category'): ChannelType[] {
  switch (kind) {
    case 'category':
      return [ChannelType.GuildCategory];
    case 'text':
    case 'announcement':
      return [ChannelType.GuildText, ChannelType.GuildAnnouncement];
    case 'forum':
      return [ChannelType.GuildForum];
    case 'voice':
      return [ChannelType.GuildVoice];
    case 'stage':
      return [ChannelType.GuildStageVoice];
  }
}

/**
 * Diffs the blueprint against the guild. Each blueprint resource is matched, in order, by the id
 * stored from a previous run, then by name (and compatible type). Unmatched resources are created.
 * Nothing outside the blueprint is ever touched. Pure, so it can be previewed and tested.
 */
export function planBuildout(snapshot: GuildSnapshot, blueprint: Blueprint = BLUEPRINT): BuildPlan {
  const items: PlanItem[] = [];
  const used = new Set<string>();

  for (const role of blueprint.roles) {
    const key = `role.${role.key}`;
    const storedId = snapshot.stored[key];
    const match =
      snapshot.roles.find((r) => r.id === storedId && !used.has(r.id)) ??
      snapshot.roles.find(
        (r) => !r.managed && !used.has(r.id) && r.name.toLowerCase() === role.name.toLowerCase(),
      );
    if (!match) {
      items.push({ key, kind: 'role', name: role.name, action: 'create' });
      continue;
    }
    used.add(match.id);
    items.push(
      match.editable
        ? { key, kind: 'role', name: role.name, action: 'update', existingId: match.id }
        : {
            key,
            kind: 'role',
            name: role.name,
            action: 'skip',
            existingId: match.id,
            note: 'sits above the bot role; move the bot role higher to manage it',
          },
    );
  }

  const findChannel = (
    key: string,
    name: string,
    kind: ChannelKind | 'category',
    parentId?: string,
  ) => {
    const types = compatibleTypes(kind);
    const storedId = snapshot.stored[key];
    const candidates = snapshot.channels.filter((c) => types.includes(c.type) && !used.has(c.id));
    const wanted = normalizeName(name);
    return (
      candidates.find((c) => c.id === storedId) ??
      candidates.find(
        (c) =>
          normalizeName(c.name) === wanted && (parentId === undefined || c.parentId === parentId),
      ) ??
      candidates.find((c) => normalizeName(c.name) === wanted)
    );
  };

  for (const category of blueprint.categories) {
    const key = `category.${category.key}`;
    const match = findChannel(key, category.name, 'category');
    if (match) used.add(match.id);
    items.push(
      match
        ? { key, kind: 'category', name: category.name, action: 'update', existingId: match.id }
        : { key, kind: 'category', name: category.name, action: 'create' },
    );

    for (const channel of category.channels) {
      const channelKey = `channel.${channel.key}`;
      const found = findChannel(channelKey, channel.name, channel.kind, match?.id);
      if (found) used.add(found.id);
      let note: string | undefined;
      if (channel.kind === 'stage' && !found && !snapshot.community) {
        note = 'needs Community; created once Community is enabled';
      } else if (channel.kind === 'announcement' && !snapshot.community) {
        note = 'becomes an Announcement channel once Community is enabled';
      }
      items.push({
        key: channelKey,
        kind: 'channel',
        name: channel.name,
        action: found ? 'update' : 'create',
        ...(found ? { existingId: found.id } : {}),
        ...(note ? { note } : {}),
      });
    }
  }

  const unmanaged = snapshot.channels
    .filter((channel) => !used.has(channel.id))
    .map(({ id, name, type }) => ({ id, name, type }));

  return {
    items,
    unmanaged,
    community: snapshot.community,
    roleIcons: Boolean(snapshot.roleIcons),
  };
}

/** Note on a resource that cannot be built yet (e.g. a stage channel before Community). */
const BLOCKED_NOTE = /^needs /;

/**
 * Blueprint resources a build would create now: what a server set up by an older version of the
 * bot is missing. Leaves out ones still waiting on something the build cannot do by itself.
 */
export function pendingCreates(plan: BuildPlan): PlanItem[] {
  return plan.items.filter(
    (item) => item.action === 'create' && !(item.note && BLOCKED_NOTE.test(item.note)),
  );
}

export function summarizePlan(
  plan: BuildPlan,
): Record<ResourceKind, { create: number; update: number; skip: number }> {
  const summary = {
    role: { create: 0, update: 0, skip: 0 },
    category: { create: 0, update: 0, skip: 0 },
    channel: { create: 0, update: 0, skip: 0 },
  };
  for (const item of plan.items) summary[item.kind][item.action] += 1;
  return summary;
}

/** Every channel key in blueprint order, used to validate references in tests. */
export function blueprintChannelKeys(blueprint: Blueprint = BLUEPRINT): string[] {
  return allChannels(blueprint).map((c) => c.key);
}
