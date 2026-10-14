import {
  baseEnvSchema,
  csvList,
  loadConfig,
  productRepoMap,
  snowflake,
  type Env,
} from '@arkhon/shared';
import { z } from 'zod';
import type { ResourceKey } from './layout.js';

function compact(
  map: Partial<Record<ResourceKey, string | undefined>>,
): Partial<Record<ResourceKey, string>> {
  const out: Partial<Record<ResourceKey, string>> = {};
  for (const [key, value] of Object.entries(map) as [ResourceKey, string | undefined][]) {
    if (value) out[key] = value;
  }
  return out;
}

const optionalSnowflake = snowflake.optional();

export const opsEnvSchema = baseEnvSchema
  .extend({
    // Exactly one of these: a Prisma database URL (SQLite file or PostgreSQL), or the Cloudflare
    // D1 bridge the Worker serves to the bot's container (deploy/cloudflare sets it).
    DATABASE_URL: z.string().min(1).optional(),
    D1_BRIDGE_URL: z.string().url().optional(),

    // Channel and role ids are optional: /setup server creates them and stores the ids in the
    // database. Set these only to point the bot at channels/roles you created by hand; an env
    // value always wins over the stored one.
    SUPPORT_CHANNEL_ID: optionalSnowflake,
    TICKET_ARCHIVE_CHANNEL_ID: optionalSnowflake,
    START_HERE_CHANNEL_ID: optionalSnowflake,
    MOD_LOG_CHANNEL_ID: optionalSnowflake,
    ANNOUNCEMENTS_CHANNEL_ID: optionalSnowflake,
    FEEDBACK_FORUM_CHANNEL_ID: optionalSnowflake,
    CERTA_HOME_CHANNEL_ID: optionalSnowflake,
    ARGUS_HOME_CHANNEL_ID: optionalSnowflake,
    CERTA_STAFF_ROLE_ID: optionalSnowflake,
    ARGUS_STAFF_ROLE_ID: optionalSnowflake,
    CERTA_USER_ROLE_ID: optionalSnowflake,
    ARGUS_USER_ROLE_ID: optionalSnowflake,

    // Tickets
    TICKET_MODE: z.enum(['thread', 'channel']).default('thread'),
    TICKET_CATEGORY_ID: optionalSnowflake,

    // AutoMod
    AUTOMOD_MENTION_LIMIT: z.coerce.number().int().min(1).max(50).default(5),
    AUTOMOD_KEYWORDS: csvList,

    // Webhooks
    WEBHOOK_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    RELEASE_WEBHOOK_SECRET: z.string().min(16, 'must be at least 16 characters'),
    GITHUB_WEBHOOK_SECRET: z.string().min(16, 'must be at least 16 characters').optional(),
    GITHUB_RELEASE_REPOS: productRepoMap,

    // Member verification against arkhonindustries.com
    ARKHON_WEBSITE_URL: z.string().url().default('https://arkhonindustries.com'),
    ARKHON_COMMUNITY_API_TOKEN: z.string().min(32, 'must be at least 32 characters').optional(),
    MEMBER_WEBHOOK_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),

    // Alt and raid shield
    VERIFY_MIN_ACCOUNT_AGE_DAYS: z.coerce.number().int().min(0).max(365).default(7),
    VERIFY_MAX_ATTEMPTS_PER_HOUR: z.coerce.number().int().min(1).max(50).default(5),
    VERIFY_RECONCILE_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
    RAID_JOIN_THRESHOLD: z.coerce.number().int().min(2).max(500).default(10),
    RAID_JOIN_WINDOW_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
    RAID_LOCKDOWN_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),

    // Feedback -> GitHub Issues
    GITHUB_TOKEN: z.string().min(1).optional(),
    GITHUB_FEEDBACK_REPOS: productRepoMap,
    FEEDBACK_PROMOTE_EMOJI: z.string().min(1).default('🚀'),
  })
  .superRefine((env, ctx) => {
    if (Boolean(env.DATABASE_URL) === Boolean(env.D1_BRIDGE_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: env.DATABASE_URL
          ? 'set DATABASE_URL or D1_BRIDGE_URL, not both'
          : 'is required (or D1_BRIDGE_URL on Cloudflare)',
      });
    }
    if (Object.keys(env.GITHUB_RELEASE_REPOS).length > 0 && !env.GITHUB_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GITHUB_WEBHOOK_SECRET'],
        message: 'is required when GITHUB_RELEASE_REPOS is set',
      });
    }
    if (Boolean(env.ARKHON_COMMUNITY_API_TOKEN) !== Boolean(env.MEMBER_WEBHOOK_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [
          env.ARKHON_COMMUNITY_API_TOKEN ? 'MEMBER_WEBHOOK_SECRET' : 'ARKHON_COMMUNITY_API_TOKEN',
        ],
        message: 'ARKHON_COMMUNITY_API_TOKEN and MEMBER_WEBHOOK_SECRET must be set together',
      });
    }
    if (Object.keys(env.GITHUB_FEEDBACK_REPOS).length > 0 && !env.GITHUB_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GITHUB_TOKEN'],
        message: 'is required when GITHUB_FEEDBACK_REPOS is set',
      });
    }
  })
  .transform((env) => ({
    env: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    database: env.D1_BRIDGE_URL
      ? ({ kind: 'd1', bridgeUrl: env.D1_BRIDGE_URL } as const)
      : ({ kind: 'url', url: env.DATABASE_URL ?? '' } as const),
    discord: {
      token: env.DISCORD_TOKEN,
      clientId: env.DISCORD_CLIENT_ID,
      guildId: env.DISCORD_GUILD_ID,
    },
    layoutOverrides: compact({
      'channel.support': env.SUPPORT_CHANNEL_ID,
      'channel.ticketArchive': env.TICKET_ARCHIVE_CHANNEL_ID,
      'channel.startHere': env.START_HERE_CHANNEL_ID,
      'channel.modLog': env.MOD_LOG_CHANNEL_ID,
      'channel.announcements': env.ANNOUNCEMENTS_CHANNEL_ID,
      'channel.feedback': env.FEEDBACK_FORUM_CHANNEL_ID,
      'channel.certaGeneral': env.CERTA_HOME_CHANNEL_ID,
      'channel.argusGeneral': env.ARGUS_HOME_CHANNEL_ID,
      'role.certaStaff': env.CERTA_STAFF_ROLE_ID,
      'role.argusStaff': env.ARGUS_STAFF_ROLE_ID,
      'role.certaUser': env.CERTA_USER_ROLE_ID,
      'role.argusUser': env.ARGUS_USER_ROLE_ID,
    }),
    tickets: {
      mode: env.TICKET_MODE,
      categoryId: env.TICKET_CATEGORY_ID,
    },
    automod: {
      mentionLimit: env.AUTOMOD_MENTION_LIMIT,
      keywords: env.AUTOMOD_KEYWORDS,
    },
    webhooks: {
      port: env.WEBHOOK_PORT,
      releaseSecret: env.RELEASE_WEBHOOK_SECRET,
      githubSecret: env.GITHUB_WEBHOOK_SECRET,
      githubReleaseRepos: env.GITHUB_RELEASE_REPOS,
    },
    verification: {
      websiteUrl: env.ARKHON_WEBSITE_URL.replace(/\/+$/, ''),
      apiToken: env.ARKHON_COMMUNITY_API_TOKEN,
      webhookSecret: env.MEMBER_WEBHOOK_SECRET,
      enabled: Boolean(env.ARKHON_COMMUNITY_API_TOKEN && env.MEMBER_WEBHOOK_SECRET),
      minAccountAgeDays: env.VERIFY_MIN_ACCOUNT_AGE_DAYS,
      maxAttemptsPerHour: env.VERIFY_MAX_ATTEMPTS_PER_HOUR,
      reconcileMinutes: env.VERIFY_RECONCILE_MINUTES,
    },
    raid: {
      joinThreshold: env.RAID_JOIN_THRESHOLD,
      windowSeconds: env.RAID_JOIN_WINDOW_SECONDS,
      lockdownMinutes: env.RAID_LOCKDOWN_MINUTES,
    },
    feedback: {
      githubToken: env.GITHUB_TOKEN,
      repos: env.GITHUB_FEEDBACK_REPOS,
      promoteEmoji: env.FEEDBACK_PROMOTE_EMOJI,
    },
  }));

export type OpsConfig = z.output<typeof opsEnvSchema>;

export function loadOpsConfig(env: Env = process.env): OpsConfig {
  return loadConfig(opsEnvSchema, env);
}
