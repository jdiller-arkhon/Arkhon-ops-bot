import type { PermissionsString } from 'discord.js';
import { styleName, type ChannelNameStyle } from './fonts.js';

/**
 * Lettering for channel names (categories stay as written). "monospace" renders
 * "👋・welcome" as "👋・𝚠𝚎𝚕𝚌𝚘𝚖𝚎". Options: monospace, sansBold, sansItalic, smallCaps, plain
 * (see fonts.ts). Changing it and re-running /setup server renames existing channels in place.
 */
export const CHANNEL_NAME_STYLE: ChannelNameStyle = 'monospace';

/**
 * The Arkhon server blueprint: every role, category and channel /setup server builds.
 *
 * This file is pure data. Edit it to change the server; re-running /setup server applies the
 * change (matching existing resources by stored id, then by name) without duplicating anything.
 * Keys are stable identifiers stored in the database; names are what members see and can be
 * changed freely.
 */

export type RoleKey =
  'team' | 'moderator' | 'certaStaff' | 'argusStaff' | 'certaUser' | 'argusUser' | 'verified';

/** Who an overwrite applies to: @everyone, the bot itself, or a blueprint role. */
export type Principal = 'everyone' | 'bot' | RoleKey;

export interface OverwriteSpec {
  principal: Principal;
  allow?: PermissionsString[];
  deny?: PermissionsString[];
}

export interface RoleSpec {
  key: RoleKey;
  name: string;
  color: number;
  /** Shown separately in the member list. */
  hoist: boolean;
  mentionable: boolean;
  permissions: PermissionsString[];
  description: string;
  /**
   * Role icon file in bots/ops/assets/role-icons (128×128 PNG; SVG sources in ./src). Shown next to
   * member names on servers with Boost Level 2 (Discord's Role Icons feature).
   */
  icon: string;
}

export type ChannelKind = 'text' | 'announcement' | 'forum' | 'voice' | 'stage';

export interface ForumSpec {
  tags: { name: string; emoji: string }[];
  requireTag: boolean;
  defaultReaction: string;
}

export interface ChannelSpec {
  key: string;
  name: string;
  kind: ChannelKind;
  topic?: string;
  slowmodeSeconds?: number;
  /** Merged on top of the category's overwrites. */
  overwrites?: OverwriteSpec[];
  forum?: ForumSpec;
  /** Listed as a default channel in native Onboarding. */
  onboardingDefault?: boolean;
}

export interface CategorySpec {
  key: string;
  name: string;
  overwrites: OverwriteSpec[];
  channels: ChannelSpec[];
}

export interface Blueprint {
  roles: RoleSpec[];
  categories: CategorySpec[];
  /** Permissions for @everyone at the server level (applied with server settings). */
  everyonePermissions: PermissionsString[];
  server: {
    description: string;
    /** Channel key Discord sends Community/safety updates to (must be a private text channel). */
    publicUpdatesChannel: string;
    rulesChannel: string;
    /** Channel key for boost messages. Join messages are suppressed: members get a DM instead. */
    systemChannel: string;
  };
  onboarding: {
    title: string;
    options: {
      title: string;
      description: string;
      emoji: string;
      roles: RoleKey[];
      channels: string[];
    }[];
  };
}

// ---------------------------------------------------------------- shared overwrite sets

const STAFF_ROLES: RoleKey[] = ['team', 'moderator', 'certaStaff', 'argusStaff'];
/** Roles that handle support tickets (Moderators do not). */
const TICKET_STAFF: RoleKey[] = ['team', 'certaStaff', 'argusStaff'];

const BOT_POSTER: OverwriteSpec = {
  principal: 'bot',
  allow: [
    'ViewChannel',
    'SendMessages',
    'EmbedLinks',
    'AttachFiles',
    'ReadMessageHistory',
    'ManageMessages',
  ],
};

/** Readable by everyone, only the bot and the Arkhon Team post. */
const READ_ONLY: OverwriteSpec[] = [
  {
    principal: 'everyone',
    allow: ['ViewChannel', 'ReadMessageHistory'],
    deny: ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads'],
  },
  { principal: 'team', allow: ['SendMessages'] },
  BOT_POSTER,
];

/**
 * Whole-server gating: hidden from @everyone, visible once a member has the Verified role
 * (granted when they link an Arkhon member ID). Staff always see it.
 */
const VERIFIED_ONLY: OverwriteSpec[] = [
  { principal: 'everyone', deny: ['ViewChannel'] },
  { principal: 'verified', allow: ['ViewChannel'] },
  ...STAFF_ROLES.map((principal) => ({ principal, allow: ['ViewChannel'] as PermissionsString[] })),
];

/** Hidden from everyone except the given roles, staff and the bot. */
function privateTo(...roles: RoleKey[]): OverwriteSpec[] {
  return [
    { principal: 'everyone', deny: ['ViewChannel'] },
    ...[...new Set([...roles, 'team' as const])].map((principal) => ({
      principal,
      allow: ['ViewChannel', 'ReadMessageHistory'] as PermissionsString[],
    })),
    { ...BOT_POSTER, allow: [...(BOT_POSTER.allow ?? []), 'Connect'] },
  ];
}

// ---------------------------------------------------------------- the blueprint

const BASE_BLUEPRINT: Blueprint = {
  roles: [
    {
      key: 'team',
      name: 'Arkhon Team',
      icon: 'team.png',
      color: 0x1d4ed8,
      hoist: true,
      mentionable: false,
      description: 'Arkhon Industries employees. Staff for every product.',
      permissions: [
        'ViewAuditLog',
        'ManageMessages',
        'ManageThreads',
        'ModerateMembers',
        'KickMembers',
        'ManageNicknames',
        'MentionEveryone',
        'MuteMembers',
        'MoveMembers',
        'ManageEvents',
      ],
    },
    {
      key: 'moderator',
      name: 'Moderator',
      icon: 'moderator.png',
      color: 0x0f766e,
      hoist: true,
      mentionable: false,
      description: 'Community moderators. Can use /mod; do not handle tickets.',
      permissions: [
        'ManageMessages',
        'ManageThreads',
        'ModerateMembers',
        'ManageNicknames',
        'MuteMembers',
        'MoveMembers',
      ],
    },
    {
      key: 'certaStaff',
      name: 'Certa Staff',
      icon: 'certaStaff.png',
      color: 0x0891b2,
      hoist: true,
      mentionable: false,
      description: 'Certa support and product team.',
      permissions: ['ManageMessages', 'ModerateMembers'],
    },
    {
      key: 'argusStaff',
      name: 'Argus Staff',
      icon: 'argusStaff.png',
      color: 0x7c3aed,
      hoist: true,
      mentionable: false,
      description: 'Argus support and product team.',
      permissions: ['ManageMessages', 'ModerateMembers'],
    },
    {
      key: 'certaUser',
      name: 'Certa User',
      icon: 'certaUser.png',
      color: 0x67e8f9,
      hoist: false,
      mentionable: true,
      description: 'Unlocks the Certa channels. Pinged for Certa releases.',
      permissions: [],
    },
    {
      key: 'argusUser',
      name: 'Argus User',
      icon: 'argusUser.png',
      color: 0xc4b5fd,
      hoist: false,
      mentionable: true,
      description: 'Unlocks the Argus channels. Pinged for Argus releases.',
      permissions: [],
    },
    {
      key: 'verified',
      name: 'Verified',
      icon: 'verified.png',
      color: 0x16a34a,
      hoist: false,
      mentionable: false,
      description:
        'Linked to an Arkhon member ID. Unlocks the server. Kept lowest so product colors show.',
      permissions: [],
    },
  ],

  categories: [
    {
      key: 'info',
      name: 'ARKHON INDUSTRIES',
      overwrites: READ_ONLY,
      channels: [
        {
          key: 'welcome',
          name: '👋・welcome',
          kind: 'text',
          topic: 'What this server is and how to find your way around.',
          onboardingDefault: true,
        },
        {
          key: 'rules',
          name: '📜・rules',
          kind: 'text',
          topic: 'Server rules. By participating you agree to follow them.',
          onboardingDefault: true,
        },
        {
          key: 'verify',
          name: '🔐・verify',
          kind: 'text',
          topic:
            'Link your Arkhon member ID to unlock the server. Disappears once you are verified.',
          overwrites: [
            { principal: 'verified', deny: ['ViewChannel'] },
            ...STAFF_ROLES.map((principal) => ({
              principal,
              allow: ['ViewChannel'] as PermissionsString[],
            })),
          ],
        },
        {
          key: 'startHere',
          name: '🚀・start-here',
          kind: 'text',
          topic: 'Pick the products you use to unlock their channels.',
          onboardingDefault: true,
          overwrites: VERIFIED_ONLY,
        },
        {
          key: 'announcements',
          name: '📣・announcements',
          kind: 'announcement',
          topic: 'Release notes and official news for Certa and Argus.',
          onboardingDefault: true,
          overwrites: VERIFIED_ONLY,
        },
      ],
    },
    {
      key: 'community',
      name: 'COMMUNITY',
      overwrites: [
        ...VERIFIED_ONLY,
        {
          principal: 'bot',
          allow: ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'],
        },
      ],
      channels: [
        {
          key: 'general',
          name: '💬・general',
          kind: 'text',
          topic: 'Chat with other pilots and the Arkhon team. Keep it friendly.',
          slowmodeSeconds: 2,
          onboardingDefault: true,
        },
        {
          key: 'introductions',
          name: '🙋・introductions',
          kind: 'text',
          topic: 'Say hello: who you are, what you fly, and what you use Certa or Argus for.',
          slowmodeSeconds: 60,
          onboardingDefault: true,
        },
        {
          key: 'showcase',
          name: '📸・showcase',
          kind: 'text',
          topic: 'Share missions, footage, setups and wins. No client or personal data.',
          slowmodeSeconds: 30,
          onboardingDefault: true,
        },
        {
          key: 'industryNews',
          name: '📰・industry-news',
          kind: 'text',
          topic: 'Drone and aviation industry news worth discussing. Always link the source.',
          slowmodeSeconds: 30,
          onboardingDefault: true,
        },
        {
          key: 'feedback',
          name: '💡・feedback',
          kind: 'forum',
          topic:
            'Ideas, bugs and requests. Tag your post Certa or Argus. Upvote with 👍. The team turns the best posts into tracked issues.',
          onboardingDefault: true,
          overwrites: [
            {
              principal: 'bot',
              allow: ['SendMessagesInThreads', 'ManageThreads', 'AddReactions'],
            },
          ],
          forum: {
            requireTag: true,
            defaultReaction: '👍',
            tags: [
              { name: 'Certa', emoji: '🛩️' },
              { name: 'Argus', emoji: '👁️' },
              { name: 'Feature request', emoji: '✨' },
              { name: 'Bug', emoji: '🐞' },
              { name: 'Question', emoji: '❓' },
            ],
          },
        },
        { key: 'lounge', name: '🔊 Lounge', kind: 'voice' },
        {
          key: 'officeHours',
          name: '🎙️ Office Hours',
          kind: 'stage',
          topic: 'Live Q&A with the Arkhon team.',
        },
      ],
    },
    {
      key: 'support',
      name: 'SUPPORT',
      overwrites: [
        {
          principal: 'everyone',
          deny: [
            'ViewChannel',
            'SendMessages',
            'CreatePublicThreads',
            'CreatePrivateThreads',
            'AddReactions',
          ],
        },
        {
          principal: 'verified',
          allow: ['ViewChannel', 'ReadMessageHistory', 'SendMessagesInThreads', 'AttachFiles'],
        },
        ...TICKET_STAFF.map((principal) => ({
          principal,
          allow: [
            'ViewChannel',
            'SendMessagesInThreads',
            'ReadMessageHistory',
            'AttachFiles',
          ] as PermissionsString[],
        })),
        // Moderators hold Manage Threads server-wide, which would reveal every private ticket
        // thread. They do not handle tickets, so it is removed here.
        { principal: 'moderator', deny: ['ManageThreads'] },
        {
          principal: 'bot',
          allow: [
            'ViewChannel',
            'SendMessages',
            'SendMessagesInThreads',
            'CreatePrivateThreads',
            'ManageThreads',
            'EmbedLinks',
            'AttachFiles',
            'ReadMessageHistory',
          ],
        },
      ],
      channels: [
        {
          key: 'support',
          name: '🎫・support',
          kind: 'text',
          topic:
            'Open a private ticket with the Certa or Argus team. Only you and staff can see it.',
          onboardingDefault: true,
        },
      ],
    },
    {
      key: 'certa',
      name: 'CERTA',
      overwrites: [
        ...privateTo('certaUser', 'certaStaff', 'moderator'),
        { principal: 'certaStaff', allow: ['ManageMessages', 'ManageThreads'] },
      ],
      channels: [
        {
          key: 'certaGeneral',
          name: '🛩️・certa-general',
          kind: 'text',
          topic: 'Everything Certa: flight operations, logbook, workflows.',
        },
        {
          key: 'certaHelp',
          name: '🧭・certa-help',
          kind: 'text',
          topic:
            'Quick questions answered by the community. For account issues, open a ticket in support.',
          slowmodeSeconds: 5,
        },
        {
          key: 'certaCompliance',
          name: '📋・certa-compliance',
          kind: 'text',
          topic: 'Regulations, audits, waivers and logbook exports. Not legal advice.',
        },
      ],
    },
    {
      key: 'argus',
      name: 'ARGUS',
      overwrites: [
        ...privateTo('argusUser', 'argusStaff', 'moderator'),
        { principal: 'argusStaff', allow: ['ManageMessages', 'ManageThreads'] },
      ],
      channels: [
        {
          key: 'argusGeneral',
          name: '👁️・argus-general',
          kind: 'text',
          topic: 'Everything Argus: setup, workflows and best practices.',
        },
        {
          key: 'argusHelp',
          name: '🧭・argus-help',
          kind: 'text',
          topic:
            'Quick questions answered by the community. For account issues, open a ticket in support.',
          slowmodeSeconds: 5,
        },
      ],
    },
    {
      key: 'staff',
      name: 'STAFF',
      overwrites: [
        ...privateTo(...STAFF_ROLES),
        {
          principal: 'bot',
          allow: ['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory'],
        },
      ],
      channels: [
        {
          key: 'staffLounge',
          name: '🛡️・staff-lounge',
          kind: 'text',
          topic: 'Private staff chat. Discord also sends Community updates here.',
        },
        {
          key: 'ticketArchive',
          name: '🗂️・ticket-archive',
          kind: 'text',
          topic: 'Transcripts of closed support tickets. Posted by the bot.',
          overwrites: [
            ...STAFF_ROLES.map((principal) => ({
              principal,
              deny: ['SendMessages'] as PermissionsString[],
            })),
            // Transcripts are customer support conversations: ticket staff only.
            { principal: 'moderator', deny: ['ViewChannel'] },
          ],
        },
        {
          key: 'modLog',
          name: '🔨・mod-log',
          kind: 'text',
          topic: 'Moderation actions and AutoMod alerts. Posted by the bot.',
          overwrites: STAFF_ROLES.map((principal) => ({ principal, deny: ['SendMessages'] })),
        },
        { key: 'staffRoom', name: '🔒 Staff Room', kind: 'voice' },
      ],
    },
  ],

  everyonePermissions: [
    'ViewChannel',
    'CreateInstantInvite',
    'ChangeNickname',
    'SendMessages',
    'SendMessagesInThreads',
    'CreatePublicThreads',
    'EmbedLinks',
    'AttachFiles',
    'AddReactions',
    'UseExternalEmojis',
    'UseExternalStickers',
    'ReadMessageHistory',
    'UseApplicationCommands',
    'SendVoiceMessages',
    'SendPolls',
    'Connect',
    'Speak',
    'Stream',
    'UseVAD',
    'RequestToSpeak',
    'UseEmbeddedActivities',
  ],

  server: {
    description:
      'The official community for Arkhon Industries pilots. Support, release notes and discussion for Certa and Argus.',
    publicUpdatesChannel: 'staffLounge',
    rulesChannel: 'rules',
    systemChannel: 'general',
  },

  onboarding: {
    title: 'Which Arkhon products do you use?',
    options: [
      {
        title: 'Certa',
        description: 'Drone flight operations and compliance logbook',
        emoji: '🛩️',
        roles: ['certaUser'],
        channels: ['certaGeneral', 'certaHelp', 'certaCompliance'],
      },
      {
        title: 'Argus',
        description: 'Argus product channels and support',
        emoji: '👁️',
        roles: ['argusUser'],
        channels: ['argusGeneral', 'argusHelp'],
      },
    ],
  },
};

/** Applies a lettering style to every channel name. */
export function withChannelNameStyle(blueprint: Blueprint, style: ChannelNameStyle): Blueprint {
  return {
    ...blueprint,
    categories: blueprint.categories.map((category) => ({
      ...category,
      channels: category.channels.map((channel) => ({
        ...channel,
        name: styleName(channel.name, style),
      })),
    })),
  };
}

export const BLUEPRINT: Blueprint = withChannelNameStyle(BASE_BLUEPRINT, CHANNEL_NAME_STYLE);

// ---------------------------------------------------------------- helpers

export function allChannels(
  blueprint: Blueprint = BLUEPRINT,
): (ChannelSpec & { category: CategorySpec })[] {
  return blueprint.categories.flatMap((category) =>
    category.channels.map((channel) => ({ ...channel, category })),
  );
}

export function findChannel(key: string, blueprint: Blueprint = BLUEPRINT) {
  return allChannels(blueprint).find((channel) => channel.key === key);
}

/**
 * Category overwrites with the channel's own overwrites merged on top. For each principal,
 * a channel allow removes a category deny and vice versa.
 */
export function mergeOverwrites(
  base: OverwriteSpec[],
  extra: OverwriteSpec[] = [],
): OverwriteSpec[] {
  const merged = new Map<
    Principal,
    { allow: Set<PermissionsString>; deny: Set<PermissionsString> }
  >();
  const apply = (spec: OverwriteSpec) => {
    const entry = merged.get(spec.principal) ?? { allow: new Set(), deny: new Set() };
    for (const perm of spec.allow ?? []) {
      entry.deny.delete(perm);
      entry.allow.add(perm);
    }
    for (const perm of spec.deny ?? []) {
      entry.allow.delete(perm);
      entry.deny.add(perm);
    }
    merged.set(spec.principal, entry);
  };
  base.forEach(apply);
  extra.forEach(apply);
  return [...merged.entries()].map(([principal, { allow, deny }]) => ({
    principal,
    allow: [...allow],
    deny: [...deny],
  }));
}

/** Every permission the blueprint grants. The bot must hold these itself to grant them. */
export function grantedPermissions(blueprint: Blueprint = BLUEPRINT): PermissionsString[] {
  const perms = new Set<PermissionsString>(blueprint.everyonePermissions);
  for (const role of blueprint.roles) role.permissions.forEach((p) => perms.add(p));
  for (const category of blueprint.categories) {
    for (const spec of category.overwrites) spec.allow?.forEach((p) => perms.add(p));
    for (const channel of category.channels) {
      for (const spec of channel.overwrites ?? []) spec.allow?.forEach((p) => perms.add(p));
    }
  }
  return [...perms];
}
