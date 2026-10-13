import type { PermissionsBitField } from 'discord.js';
import {
  ChannelFlags,
  ChannelType,
  ForumLayoutType,
  GuildDefaultMessageNotifications,
  GuildExplicitContentFilter,
  GuildFeature,
  GuildOnboardingMode,
  GuildOnboardingPromptType,
  GuildSystemChannelFlags,
  GuildVerificationLevel,
  OverwriteType,
  PermissionFlagsBits,
  SortOrderType,
  type Guild,
  type GuildChannelCreateOptions,
  type GuildChannelEditOptions,
  type GuildForumTagData,
  type OverwriteResolvable,
  type PermissionsString,
} from 'discord.js';
import type { OpsContext } from '../context.js';
import { runLayoutTasks } from '../startup.js';
import {
  BLUEPRINT,
  grantedPermissions,
  mergeOverwrites,
  type Blueprint,
  type CategorySpec,
  type ChannelSpec,
  type OverwriteSpec,
  type RoleKey,
} from './blueprint.js';
import type { BuildPlan, GuildSnapshot, PlanItem, ResourceKind } from './plan.js';

export interface BuildOptions {
  /** Verification level, content filter, notifications, @everyone permissions. */
  serverSettings: boolean;
  /** Turn on Community (announcement channels, forum, stage, onboarding). */
  community: boolean;
  /** Configure native Onboarding (requires Community). */
  onboarding: boolean;
}

export interface BuildReport {
  created: string[];
  updated: string[];
  skipped: string[];
  warnings: string[];
  durationMs: number;
}

export type ProgressFn = (step: string) => Promise<void>;

/** Permissions the bot needs to manage the server, beyond what it grants to others. */
const MANAGEMENT_PERMISSIONS: PermissionsString[] = [
  'ManageRoles',
  'ManageChannels',
  'ManageGuild',
];

/** Permission names the bot lacks to apply the blueprint. Administrator covers everything. */
export function missingBotPermissions(
  botPermissions: Readonly<PermissionsBitField>,
  blueprint: Blueprint = BLUEPRINT,
): PermissionsString[] {
  if (botPermissions.has(PermissionFlagsBits.Administrator)) return [];
  const needed = new Set<PermissionsString>([
    ...MANAGEMENT_PERMISSIONS,
    ...grantedPermissions(blueprint),
  ]);
  return [...needed].filter((perm) => !botPermissions.has(PermissionFlagsBits[perm])).sort();
}

export interface OverwriteIds {
  guildId: string;
  botId: string;
  roles: Partial<Record<RoleKey, string>>;
}

/** Turns principal-based overwrite specs into Discord overwrites. Unknown roles are left out. */
export function resolveOverwrites(
  specs: OverwriteSpec[],
  ids: OverwriteIds,
): OverwriteResolvable[] {
  const out: OverwriteResolvable[] = [];
  for (const spec of specs) {
    let id: string | undefined;
    let type: OverwriteType;
    if (spec.principal === 'everyone') {
      id = ids.guildId;
      type = OverwriteType.Role;
    } else if (spec.principal === 'bot') {
      id = ids.botId;
      type = OverwriteType.Member;
    } else {
      id = ids.roles[spec.principal];
      type = OverwriteType.Role;
    }
    if (!id) continue;
    const allow = spec.allow ?? [];
    const deny = spec.deny ?? [];
    if (allow.length === 0 && deny.length === 0) continue;
    out.push({ id, type, allow, deny });
  }
  return out;
}

/** Reads the parts of the guild the planner needs. */
export async function snapshotGuild(ctx: OpsContext, guild: Guild): Promise<GuildSnapshot> {
  const [roles, channels, stored, me] = await Promise.all([
    guild.roles.fetch(),
    guild.channels.fetch(),
    ctx.prisma.opsServerResource.findMany(),
    guild.members.fetchMe(),
  ]);
  return {
    roles: roles
      .filter((role) => role.id !== guild.id)
      .map((role) => ({
        id: role.id,
        name: role.name,
        managed: role.managed,
        editable: me.roles.highest.comparePositionTo(role) > 0 && !role.managed,
      })),
    channels: channels
      .filter((channel): channel is NonNullable<typeof channel> => channel !== null)
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        parentId: channel.parentId,
      })),
    stored: Object.fromEntries(stored.map((row) => [row.key, row.discordId])),
    community: guild.features.includes(GuildFeature.Community),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Applies a plan to the guild. Every resource is handled independently: one failure becomes a
 * warning and the build continues. Ids are saved as they are resolved, so an interrupted build
 * picks up where it stopped on the next run.
 */
export async function executeBuildout(
  ctx: OpsContext,
  guildInput: Guild,
  plan: BuildPlan,
  options: BuildOptions,
  progress: ProgressFn,
  blueprint: Blueprint = BLUEPRINT,
): Promise<BuildReport> {
  const started = Date.now();
  const report: BuildReport = {
    created: [],
    updated: [],
    skipped: [],
    warnings: [],
    durationMs: 0,
  };
  const reason = 'Arkhon Ops /setup server';
  let guild = guildInput;
  const me = await guild.members.fetchMe();
  const ids: Record<string, string> = {};
  const itemByKey = new Map(plan.items.map((item) => [item.key, item]));
  const item = (key: string): PlanItem => {
    const found = itemByKey.get(key);
    if (!found) throw new Error(`No plan item for ${key}`);
    return found;
  };

  const save = async (key: string, kind: ResourceKind, discordId: string) => {
    ids[key] = discordId;
    await ctx.prisma.opsServerResource.upsert({
      where: { key },
      create: { key, kind, discordId },
      update: { kind, discordId },
    });
  };
  const record = (planItem: PlanItem, created: boolean) =>
    (created ? report.created : report.updated).push(planItem.name);
  const attempt = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      report.warnings.push(`${label}: ${errorMessage(error)}`);
      ctx.logger.warn({ err: error, step: label }, 'setup step failed');
    }
  };
  const overwriteIds = (): OverwriteIds => ({
    guildId: guild.id,
    botId: me.id,
    roles: Object.fromEntries(
      blueprint.roles.map((role) => [role.key, ids[`role.${role.key}`]]).filter(([, id]) => id),
    ) as Partial<Record<RoleKey, string>>,
  });
  const isCommunity = () => guild.features.includes(GuildFeature.Community);

  // ---------------------------------------------------------------- roles
  await progress('Creating roles');
  for (const role of blueprint.roles) {
    const planItem = item(`role.${role.key}`);
    if (planItem.action === 'skip') {
      if (planItem.existingId) ids[planItem.key] = planItem.existingId;
      report.skipped.push(`${role.name} (${planItem.note ?? 'skipped'})`);
      continue;
    }
    await attempt(`Role ${role.name}`, async () => {
      const data = {
        name: role.name,
        colors: { primaryColor: role.color },
        hoist: role.hoist,
        mentionable: role.mentionable,
        permissions: role.permissions,
        reason,
      };
      const result = planItem.existingId
        ? await guild.roles.edit(planItem.existingId, data)
        : await guild.roles.create(data);
      await save(planItem.key, 'role', result.id);
      record(planItem, !planItem.existingId);
    });
  }
  await attempt('Role order', async () => {
    const top = me.roles.highest.position;
    const positions = blueprint.roles
      .map((role, index) => ({ id: ids[`role.${role.key}`], index }))
      .filter((entry): entry is { id: string; index: number } => Boolean(entry.id))
      .filter((entry) => item(`role.${blueprint.roles[entry.index]!.key}`).action !== 'skip')
      .map((entry) => ({ role: entry.id, position: Math.max(1, top - 1 - entry.index) }));
    if (positions.length > 0) await guild.roles.setPositions(positions);
  });

  // ---------------------------------------------------------------- server settings
  if (options.serverSettings) {
    await progress('Applying server settings');
    await attempt('@everyone permissions', async () => {
      await guild.roles.everyone.setPermissions(blueprint.everyonePermissions, reason);
    });
  }

  // ---------------------------------------------------------------- categories + channels
  await progress('Building categories and channels');
  const deferred: { category: CategorySpec; channel: ChannelSpec }[] = [];
  for (const category of blueprint.categories) {
    const catItem = item(`category.${category.key}`);
    await attempt(`Category ${category.name}`, async () => {
      const permissionOverwrites = resolveOverwrites(category.overwrites, overwriteIds());
      const result = catItem.existingId
        ? await guild.channels.edit(catItem.existingId, {
            name: category.name,
            permissionOverwrites,
            reason,
          })
        : await guild.channels.create({
            name: category.name,
            type: ChannelType.GuildCategory,
            permissionOverwrites,
            reason,
          });
      await save(catItem.key, 'category', result.id);
      record(catItem, !catItem.existingId);
    });

    for (const channel of category.channels) {
      if (channel.kind === 'forum' || channel.kind === 'stage') {
        deferred.push({ category, channel });
        continue;
      }
      await attempt(`Channel ${channel.name}`, () => upsertChannel(category, channel));
    }
  }

  async function upsertChannel(category: CategorySpec, channel: ChannelSpec): Promise<void> {
    const planItem = item(`channel.${channel.key}`);
    const parent = ids[`category.${category.key}`] ?? null;
    const permissionOverwrites = resolveOverwrites(
      mergeOverwrites(category.overwrites, channel.overwrites),
      overwriteIds(),
    );
    const textual =
      channel.kind === 'text' || channel.kind === 'announcement' || channel.kind === 'forum';
    const type = channelType(channel.kind, isCommunity());
    const common = {
      name: channel.name,
      parent,
      permissionOverwrites,
      ...(textual && channel.topic ? { topic: channel.topic } : {}),
      ...(textual ? { rateLimitPerUser: channel.slowmodeSeconds ?? 0 } : {}),
      reason,
    };
    const forumExtras =
      channel.kind === 'forum' && channel.forum
        ? {
            defaultReactionEmoji: { id: null, name: channel.forum.defaultReaction },
            defaultSortOrder: SortOrderType.LatestActivity,
            defaultForumLayout: ForumLayoutType.ListView,
          }
        : {};

    let result: { id: string };
    if (planItem.existingId) {
      const existing = await guild.channels.fetch(planItem.existingId);
      if (!existing) throw new Error('channel disappeared');
      const edit: GuildChannelEditOptions = { ...common, ...forumExtras };
      if (
        channel.kind === 'announcement' &&
        isCommunity() &&
        existing.type === ChannelType.GuildText
      ) {
        edit.type = ChannelType.GuildAnnouncement;
      }
      if (channel.kind === 'forum' && channel.forum && existing.type === ChannelType.GuildForum) {
        edit.availableTags = mergeForumTags(existing.availableTags, channel.forum.tags);
      }
      result = await guild.channels.edit(existing, edit);
    } else {
      const create = {
        ...common,
        ...forumExtras,
        type,
        ...(channel.kind === 'forum' && channel.forum
          ? { availableTags: mergeForumTags([], channel.forum.tags) }
          : {}),
      } as GuildChannelCreateOptions & { type: typeof type };
      result = await guild.channels.create(create);
    }
    if (channel.kind === 'forum' && channel.forum?.requireTag) {
      const forum = await guild.channels.fetch(result.id);
      if (forum?.type === ChannelType.GuildForum && !forum.flags.has(ChannelFlags.RequireTag)) {
        await guild.channels.edit(forum, {
          flags: [...forum.flags.toArray(), 'RequireTag'],
          reason,
        });
      }
    }
    await save(planItem.key, 'channel', result.id);
    record(planItem, !planItem.existingId);
  }

  // ---------------------------------------------------------------- community + server settings
  if (options.serverSettings || options.community) {
    await attempt('Server settings', async () => {
      const systemChannel = ids[`channel.${blueprint.server.systemChannel}`];
      guild = await guild.edit({
        verificationLevel: GuildVerificationLevel.Medium,
        explicitContentFilter: GuildExplicitContentFilter.AllMembers,
        ...(options.serverSettings
          ? {
              defaultMessageNotifications: GuildDefaultMessageNotifications.OnlyMentions,
              ...(systemChannel ? { systemChannel } : {}),
              systemChannelFlags: [
                GuildSystemChannelFlags.SuppressJoinNotifications,
                GuildSystemChannelFlags.SuppressJoinNotificationReplies,
                GuildSystemChannelFlags.SuppressGuildReminderNotifications,
              ],
            }
          : {}),
        reason,
      });
    });
  }
  if (options.community) {
    await progress('Enabling Community');
    await attempt('Community', async () => {
      const rulesChannel = ids[`channel.${blueprint.server.rulesChannel}`];
      const publicUpdatesChannel = ids[`channel.${blueprint.server.publicUpdatesChannel}`];
      if (!rulesChannel || !publicUpdatesChannel)
        throw new Error('rules or staff channel was not created');
      const features = isCommunity() ? guild.features : [...guild.features, GuildFeature.Community];
      guild = await guild.edit({
        features: features as `${GuildFeature}`[],
        rulesChannel,
        publicUpdatesChannel,
        description: blueprint.server.description,
        reason,
      });
      guild = await guild.fetch();
      if (!isCommunity()) throw new Error('Discord did not enable Community');
    });
    if (!isCommunity()) {
      report.warnings.push(
        'Community is off, so announcements stay text channels and Office Hours/Onboarding are skipped. Enable it in Server Settings → Enable Community, then run /setup server again.',
      );
    }
  }

  // ---------------------------------------------------------------- community-only channels
  await progress('Finishing channels');
  for (const category of blueprint.categories) {
    for (const channel of category.channels) {
      if (channel.kind === 'announcement' && isCommunity()) {
        const id = ids[`channel.${channel.key}`];
        if (!id) continue;
        await attempt(`Announcement channel ${channel.name}`, async () => {
          const existing = await guild.channels.fetch(id);
          if (existing?.type === ChannelType.GuildText) {
            await guild.channels.edit(existing, { type: ChannelType.GuildAnnouncement, reason });
          }
        });
      }
    }
  }
  for (const { category, channel } of deferred) {
    if (channel.kind === 'stage' && !isCommunity()) {
      report.skipped.push(`${channel.name} (needs Community)`);
      continue;
    }
    await attempt(`Channel ${channel.name}`, () => upsertChannel(category, channel));
  }

  await attempt('Channel order', async () => {
    const positions = blueprint.categories.flatMap((category, catIndex) => {
      const catId = ids[`category.${category.key}`];
      if (!catId) return [];
      return [
        { channel: catId, position: catIndex },
        ...category.channels
          .map((channel, index) => ({ id: ids[`channel.${channel.key}`], index }))
          .filter((entry): entry is { id: string; index: number } => Boolean(entry.id))
          .map((entry) => ({
            channel: entry.id,
            position: entry.index,
            parent: catId,
            lockPermissions: false,
          })),
      ];
    });
    await guild.channels.setPositions(positions);
  });

  // ---------------------------------------------------------------- onboarding
  if (options.onboarding) {
    if (!isCommunity()) {
      report.skipped.push('Onboarding (needs Community)');
    } else {
      await progress('Configuring Onboarding');
      await attempt('Onboarding', async () => {
        const current = await guild.fetchOnboarding().catch(() => null);
        const existingPrompt = current?.prompts.find((p) => p.title === blueprint.onboarding.title);
        const pick = (keys: string[], prefix: string) =>
          keys.map((key) => ids[`${prefix}.${key}`]).filter((id): id is string => Boolean(id));
        const prompts = [
          {
            ...(existingPrompt ? { id: existingPrompt.id } : {}),
            title: blueprint.onboarding.title,
            singleSelect: false,
            required: true,
            inOnboarding: true,
            type: GuildOnboardingPromptType.MultipleChoice,
            options: blueprint.onboarding.options.map((option) => ({
              title: option.title,
              description: option.description,
              emoji: option.emoji,
              roles: pick(option.roles, 'role'),
              channels: pick(option.channels, 'channel'),
            })),
          },
        ];
        const defaultChannels = pick(
          blueprint.categories.flatMap((c) =>
            c.channels.filter((ch) => ch.onboardingDefault).map((ch) => ch.key),
          ),
          'channel',
        );
        try {
          await guild.editOnboarding({
            prompts,
            defaultChannels,
            enabled: true,
            mode: GuildOnboardingMode.OnboardingDefault,
            reason,
          });
        } catch (error) {
          // Save the questions even when Discord refuses to switch Onboarding on.
          await guild.editOnboarding({ prompts, defaultChannels, enabled: false, reason });
          throw new Error(
            `questions saved but Onboarding is not enabled (${errorMessage(error)}). Turn it on in Server Settings → Onboarding`,
          );
        }
      });
    }
  }

  // ---------------------------------------------------------------- go live
  await progress('Posting panels and AutoMod rules');
  await ctx.layout.load(ctx.prisma);
  if (!ctx.layout.current) {
    report.warnings.push(`Layout still incomplete: missing ${ctx.layout.missing.join(', ')}`);
  } else {
    const failures = await runLayoutTasks(ctx, guild);
    report.warnings.push(...failures);
  }

  report.durationMs = Date.now() - started;
  ctx.logger.info(
    {
      created: report.created.length,
      updated: report.updated.length,
      skipped: report.skipped.length,
      warnings: report.warnings.length,
      durationMs: report.durationMs,
    },
    'server buildout finished',
  );
  return report;
}

function channelType(kind: ChannelSpec['kind'], community: boolean) {
  switch (kind) {
    case 'text':
      return ChannelType.GuildText;
    case 'announcement':
      return community ? ChannelType.GuildAnnouncement : ChannelType.GuildText;
    case 'forum':
      return ChannelType.GuildForum;
    case 'voice':
      return ChannelType.GuildVoice;
    case 'stage':
      return ChannelType.GuildStageVoice;
  }
}

/** Keeps existing forum tags (they may be in use) and adds blueprint tags that are missing. */
export function mergeForumTags(
  existing: readonly GuildForumTagData[],
  wanted: { name: string; emoji: string }[],
): GuildForumTagData[] {
  const tags: GuildForumTagData[] = existing.map((tag) => ({ ...tag }));
  for (const tag of wanted) {
    if (tags.some((t) => t.name.toLowerCase() === tag.name.toLowerCase())) continue;
    tags.push({ name: tag.name, moderated: false, emoji: { id: null, name: tag.emoji } });
  }
  return tags.slice(0, 20);
}
