/**
 * Which bots run on Cloudflare and how requests reach them. Pure data and helpers, no Workers
 * APIs, so it is unit-tested with the rest of the repo.
 *
 * Each bot is one always-on container (a long-lived discord.js gateway process) behind this
 * Worker. To add the Argus bot once it exists: add an entry here, a container class in
 * worker.ts, and a containers / durable_objects / migrations entry in wrangler.jsonc.
 */

import { D1_BRIDGE_HOST } from '../../../packages/shared/src/d1-bridge.js';

export type BotKey = 'ops' | 'certa';

export interface BotDeployment {
  /** Durable Object binding name in wrangler.jsonc. */
  binding: 'OPS_BOT' | 'CERTA_BOT';
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

/**
 * Variables every bot takes (packages/shared baseEnvSchema). DATABASE_URL is not passed: on
 * Cloudflare the database is D1, reached through the Worker (D1_BRIDGE_URL, set by containerEnv).
 */
const BASE_ENV_KEYS = [
  'LOG_LEVEL',
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
  'CERTA_DISCORD_CLIENT_ID',
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

/**
 * bots/certa/src/config.ts. The Certa bot is its own Discord application: it reads
 * CERTA_DISCORD_TOKEN / CERTA_DISCORD_CLIENT_ID, never the Ops bot's DISCORD_TOKEN.
 */
const CERTA_ENV_KEYS = [
  'LOG_LEVEL',
  'DISCORD_GUILD_ID',
  'CERTA_DISCORD_TOKEN',
  'CERTA_DISCORD_CLIENT_ID',
  'CERTA_API_MODE',
  'CERTA_API_BASE_URL',
  'CERTA_API_TOKEN',
  'CERTA_TIMEZONE',
  'CERTA_REMINDER_TIME',
  'CERTA_PREFLIGHT_TIME',
  'CERTA_PREFLIGHT_AIRPORTS',
  'CERTA_LEADERBOARD_TIME',
  'CERTA_FLIGHT_LOGS_CHANNEL_ID',
  'CERTA_PREFLIGHT_CHANNEL_ID',
  'CERTA_HOME_CHANNEL_ID',
  'PREFLIGHT_MAX_WIND_KT',
  'PREFLIGHT_MAX_GUST_KT',
  'PREFLIGHT_MIN_VISIBILITY_SM',
  'PREFLIGHT_MIN_CEILING_FT',
  'PREFLIGHT_KP_CAUTION',
  'PREFLIGHT_TFR_RADIUS_NM',
] as const;

export const BOTS: Record<BotKey, BotDeployment> = {
  ops: {
    binding: 'OPS_BOT',
    port: 3000,
    // bots/ops/src/releases/server.ts and verification/webhook.ts
    paths: ['/healthz', '/webhooks/release', '/webhooks/github', '/webhooks/member'],
    envKeys: OPS_ENV_KEYS,
    required: ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID', 'RELEASE_WEBHOOK_SECRET'],
  },
  certa: {
    binding: 'CERTA_BOT',
    port: 3001,
    // No public routes: the Worker reaches /healthz directly on the container.
    paths: [],
    envKeys: CERTA_ENV_KEYS,
    // CERTA_API_MODE must be chosen explicitly (mock until the Certa API is live), so a missing
    // setting is reported instead of the bot failing on its http-mode settings.
    required: [
      'CERTA_DISCORD_TOKEN',
      'CERTA_DISCORD_CLIENT_ID',
      'DISCORD_GUILD_ID',
      'CERTA_API_MODE',
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

/** Where a bot container reaches its D1 database (intercepted by the Worker, never public). */
export const D1_BRIDGE_URL = `http://${D1_BRIDGE_HOST}`;

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
  out.D1_BRIDGE_URL = D1_BRIDGE_URL;
  return out;
}

/** Required variables that are missing, so the Worker can report them instead of crash-looping. */
export function missingRequired(bot: BotDeployment, env: Record<string, string>): string[] {
  return bot.required.filter((key) => !env[key]);
}

/**
 * Fingerprint of a container environment. The container records the fingerprint it started with;
 * when the Worker's secrets change, the fingerprints differ and the Worker restarts the container
 * so the bot picks up the new values (a deploy alone does not restart an unchanged image).
 */
export async function envFingerprint(env: Record<string, string>): Promise<string> {
  const canonical = JSON.stringify(
    Object.keys(env)
      .sort()
      .map((key) => [key, env[key]]),
  );
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Every variable any bot reads, i.e. what the Worker should hold as secrets or vars. */
export function allEnvKeys(): string[] {
  return [...new Set(Object.values(BOTS).flatMap((bot) => bot.envKeys))].sort();
}

/**
 * The Worker secrets to upload: known bot variables with non-empty string values, taken from the
 * given sources in order (later sources win). Used by CI to copy GitHub secrets to Cloudflare.
 */
export function workerSecrets(...sources: Record<string, unknown>[]): Record<string, string> {
  const keys = allEnvKeys();
  const out: Record<string, string> = {};
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim() !== '') out[key] = value;
    }
  }
  return out;
}
