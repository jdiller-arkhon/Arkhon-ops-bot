/**
 * Which bots run on Cloudflare and how requests reach them. Pure data and helpers, no Workers
 * APIs, so it is unit-tested with the rest of the repo.
 *
 * Each bot is one always-on container (a long-lived discord.js gateway process) behind this
 * Worker. To add the Certa or Argus bot once it exists: add an entry here, a container class in
 * worker.ts, and a containers / durable_objects / migrations entry in wrangler.jsonc.
 */

export type BotKey = 'ops';

export interface BotDeployment {
  /** Durable Object binding name in wrangler.jsonc. */
  binding: 'OPS_BOT';
  /** Port the bot's HTTP server listens on inside the container (WEBHOOK_PORT). */
  port: number;
  /** Public paths the Worker forwards to this bot. */
  paths: readonly string[];
  /** Environment variables copied from Worker secrets/vars into the container. */
  envKeys: readonly string[];
  /** Variables the bot refuses to start without. */
  required: readonly string[];
}

/** Every bot runs as exactly one instance: two gateway connections would answer everything twice. */
export const INSTANCE_NAME = 'primary';

/** Variables every bot takes (packages/shared baseEnvSchema plus DATABASE_URL). */
const BASE_ENV_KEYS = [
  'LOG_LEVEL',
  'DATABASE_URL',
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_GUILD_ID',
] as const;

/** bots/ops/src/config.ts. Keep in sync; a test compares this list with .env.example. */
const OPS_ENV_KEYS = [
  ...BASE_ENV_KEYS,
  'SUPPORT_CHANNEL_ID',
  'TICKET_ARCHIVE_CHANNEL_ID',
  'START_HERE_CHANNEL_ID',
  'MOD_LOG_CHANNEL_ID',
  'ANNOUNCEMENTS_CHANNEL_ID',
  'FEEDBACK_FORUM_CHANNEL_ID',
  'CERTA_HOME_CHANNEL_ID',
  'ARGUS_HOME_CHANNEL_ID',
  'CERTA_STAFF_ROLE_ID',
  'ARGUS_STAFF_ROLE_ID',
  'CERTA_USER_ROLE_ID',
  'ARGUS_USER_ROLE_ID',
  'TICKET_MODE',
  'TICKET_CATEGORY_ID',
  'AUTOMOD_MENTION_LIMIT',
  'AUTOMOD_KEYWORDS',
  'RELEASE_WEBHOOK_SECRET',
  'GITHUB_WEBHOOK_SECRET',
  'GITHUB_RELEASE_REPOS',
  'ARKHON_WEBSITE_URL',
  'ARKHON_COMMUNITY_API_TOKEN',
  'MEMBER_WEBHOOK_SECRET',
  'VERIFY_MIN_ACCOUNT_AGE_DAYS',
  'VERIFY_MAX_ATTEMPTS_PER_HOUR',
  'VERIFY_RECONCILE_MINUTES',
  'RAID_JOIN_THRESHOLD',
  'RAID_JOIN_WINDOW_SECONDS',
  'RAID_LOCKDOWN_MINUTES',
  'GITHUB_TOKEN',
  'GITHUB_FEEDBACK_REPOS',
  'FEEDBACK_PROMOTE_EMOJI',
] as const;

export const BOTS: Record<BotKey, BotDeployment> = {
  ops: {
    binding: 'OPS_BOT',
    port: 3000,
    // bots/ops/src/releases/server.ts and verification/webhook.ts
    paths: ['/healthz', '/webhooks/release', '/webhooks/github', '/webhooks/member'],
    envKeys: OPS_ENV_KEYS,
    required: [
      'DATABASE_URL',
      'DISCORD_TOKEN',
      'DISCORD_CLIENT_ID',
      'DISCORD_GUILD_ID',
      'RELEASE_WEBHOOK_SECRET',
    ],
  },
};

/** The bot that serves a request path, or undefined for anything else (answered with 404). */
export function botForPath(pathname: string): BotKey | undefined {
  for (const [key, bot] of Object.entries(BOTS) as [BotKey, BotDeployment][]) {
    if (bot.paths.includes(pathname)) return key;
  }
  return undefined;
}

/**
 * The container's environment: the bot's keys that are set on the Worker (non-empty strings
 * only), plus the values the deployment fixes itself.
 */
export function containerEnv(
  bot: BotDeployment,
  env: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of bot.envKeys) {
    const value = env[key];
    if (typeof value === 'string' && value !== '') out[key] = value;
  }
  out.NODE_ENV = 'production';
  out.WEBHOOK_PORT = String(bot.port);
  return out;
}

/** Required variables that are missing, so the Worker can report them instead of crash-looping. */
export function missingRequired(bot: BotDeployment, env: Record<string, string>): string[] {
  const missing = bot.required.filter((key) => !env[key]);
  if (env.DATABASE_URL?.startsWith('file:')) missing.push('DATABASE_URL (must be PostgreSQL)');
  return missing;
}
