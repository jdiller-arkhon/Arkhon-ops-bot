import {
  baseEnvSchema,
  csvList,
  loadConfig,
  productRepoMap,
  snowflake,
  type Env,
  type Product,
} from '@arkhon/shared';
import { z } from 'zod';

const optionalSnowflake = snowflake.optional();

export const opsEnvSchema = baseEnvSchema
  .extend({
    DATABASE_URL: z.string().min(1),

    // Channels
    SUPPORT_CHANNEL_ID: snowflake,
    TICKET_ARCHIVE_CHANNEL_ID: snowflake,
    START_HERE_CHANNEL_ID: snowflake,
    MOD_LOG_CHANNEL_ID: snowflake,
    ANNOUNCEMENTS_CHANNEL_ID: snowflake,
    FEEDBACK_FORUM_CHANNEL_ID: snowflake,
    CERTA_HOME_CHANNEL_ID: snowflake,
    ARGUS_HOME_CHANNEL_ID: snowflake,

    // Roles
    CERTA_STAFF_ROLE_ID: snowflake,
    ARGUS_STAFF_ROLE_ID: snowflake,
    CERTA_USER_ROLE_ID: snowflake,
    ARGUS_USER_ROLE_ID: snowflake,

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

    // Feedback -> GitHub Issues
    GITHUB_TOKEN: z.string().min(1).optional(),
    GITHUB_FEEDBACK_REPOS: productRepoMap,
    FEEDBACK_PROMOTE_EMOJI: z.string().min(1).default('🚀'),
  })
  .superRefine((env, ctx) => {
    if (Object.keys(env.GITHUB_RELEASE_REPOS).length > 0 && !env.GITHUB_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GITHUB_WEBHOOK_SECRET'],
        message: 'is required when GITHUB_RELEASE_REPOS is set',
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
    databaseUrl: env.DATABASE_URL,
    discord: {
      token: env.DISCORD_TOKEN,
      clientId: env.DISCORD_CLIENT_ID,
      guildId: env.DISCORD_GUILD_ID,
    },
    channels: {
      support: env.SUPPORT_CHANNEL_ID,
      ticketArchive: env.TICKET_ARCHIVE_CHANNEL_ID,
      startHere: env.START_HERE_CHANNEL_ID,
      modLog: env.MOD_LOG_CHANNEL_ID,
      announcements: env.ANNOUNCEMENTS_CHANNEL_ID,
      feedbackForum: env.FEEDBACK_FORUM_CHANNEL_ID,
      home: { certa: env.CERTA_HOME_CHANNEL_ID, argus: env.ARGUS_HOME_CHANNEL_ID } satisfies Record<
        Product,
        string
      >,
    },
    roles: {
      staff: { certa: env.CERTA_STAFF_ROLE_ID, argus: env.ARGUS_STAFF_ROLE_ID } satisfies Record<
        Product,
        string
      >,
      user: { certa: env.CERTA_USER_ROLE_ID, argus: env.ARGUS_USER_ROLE_ID } satisfies Record<
        Product,
        string
      >,
    },
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
