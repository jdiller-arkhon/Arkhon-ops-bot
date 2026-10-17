import { baseEnvSchema, csvList, loadConfig, snowflake, type Env } from '@arkhon/shared';
import { IANAZone } from 'luxon';
import { z } from 'zod';

const optionalSnowflake = snowflake.optional();
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:mm (24-hour)');
const icao = z.string().regex(/^[A-Z][A-Z0-9]{3}$/, 'must be a 4-character ICAO code like KDEN');
const threshold = (fallback: number) => z.coerce.number().finite().nonnegative().default(fallback);

/**
 * The Certa bot is its own Discord application, so it reads CERTA_DISCORD_TOKEN and
 * CERTA_DISCORD_CLIENT_ID instead of the Ops bot's DISCORD_TOKEN / DISCORD_CLIENT_ID. Both bots
 * share DISCORD_GUILD_ID, the database and the rest of .env.
 */
export const certaEnvSchema = baseEnvSchema
  .omit({ DISCORD_TOKEN: true, DISCORD_CLIENT_ID: true })
  .extend({
    CERTA_DISCORD_TOKEN: z.string().min(50, 'does not look like a bot token'),
    CERTA_DISCORD_CLIENT_ID: snowflake,

    // Same database rules as the Ops bot: a Prisma URL, or the Cloudflare D1 bridge.
    DATABASE_URL: z.string().min(1).optional(),
    D1_BRIDGE_URL: z.string().url().optional(),
    // Port for /healthz (the Cloudflare Worker and Docker check it). Set by the deployment.
    WEBHOOK_PORT: z.coerce.number().int().min(1).max(65535).default(3001),

    // Certa backend: "http" for the real API, "mock" to run entirely off the bot's database.
    CERTA_API_MODE: z.enum(['http', 'mock']).default('http'),
    CERTA_API_BASE_URL: z.string().url().optional(),
    CERTA_API_TOKEN: z.string().min(1).optional(),

    CERTA_TIMEZONE: z
      .string()
      .default('America/Denver')
      .refine(
        (zone) => IANAZone.isValidZone(zone),
        'must be an IANA time zone like America/Denver',
      ),
    CERTA_REMINDER_TIME: localTime.default('09:00'),
    CERTA_PREFLIGHT_TIME: localTime.default('06:30'),
    CERTA_PREFLIGHT_AIRPORTS: csvList.pipe(z.array(icao)),
    CERTA_LEADERBOARD_TIME: localTime.default('09:00'),

    // Channel overrides. Leave empty: /setup server (Ops bot) creates #flight-logs, #preflight
    // and #certa-general and stores their ids, which this bot reads.
    CERTA_FLIGHT_LOGS_CHANNEL_ID: optionalSnowflake,
    CERTA_PREFLIGHT_CHANNEL_ID: optionalSnowflake,
    CERTA_HOME_CHANNEL_ID: optionalSnowflake,

    PREFLIGHT_MAX_WIND_KT: threshold(15),
    PREFLIGHT_MAX_GUST_KT: threshold(20),
    PREFLIGHT_MIN_VISIBILITY_SM: threshold(3),
    PREFLIGHT_MIN_CEILING_FT: threshold(1000),
    PREFLIGHT_KP_CAUTION: threshold(5),
    PREFLIGHT_TFR_RADIUS_NM: threshold(30),
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
    if (env.CERTA_API_MODE === 'http') {
      for (const key of ['CERTA_API_BASE_URL', 'CERTA_API_TOKEN'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message:
              'is required when CERTA_API_MODE=http (use CERTA_API_MODE=mock until the API is live)',
          });
        }
      }
    }
  })
  .transform((env) => ({
    env: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    database: env.D1_BRIDGE_URL
      ? ({ kind: 'd1', bridgeUrl: env.D1_BRIDGE_URL } as const)
      : ({ kind: 'url', url: env.DATABASE_URL ?? '' } as const),
    healthPort: env.WEBHOOK_PORT,
    discord: {
      token: env.CERTA_DISCORD_TOKEN,
      clientId: env.CERTA_DISCORD_CLIENT_ID,
      guildId: env.DISCORD_GUILD_ID,
    },
    api:
      env.CERTA_API_MODE === 'http'
        ? ({
            mode: 'http',
            baseUrl: env.CERTA_API_BASE_URL ?? '',
            token: env.CERTA_API_TOKEN ?? '',
          } as const)
        : ({ mode: 'mock' } as const),
    timezone: env.CERTA_TIMEZONE,
    schedule: {
      reminders: env.CERTA_REMINDER_TIME,
      preflight: env.CERTA_PREFLIGHT_TIME,
      leaderboard: env.CERTA_LEADERBOARD_TIME,
    },
    preflightAirports: env.CERTA_PREFLIGHT_AIRPORTS,
    channelOverrides: {
      flightLogs: env.CERTA_FLIGHT_LOGS_CHANNEL_ID,
      preflight: env.CERTA_PREFLIGHT_CHANNEL_ID,
      home: env.CERTA_HOME_CHANNEL_ID,
    },
    thresholds: {
      maxWindKt: env.PREFLIGHT_MAX_WIND_KT,
      maxGustKt: env.PREFLIGHT_MAX_GUST_KT,
      minVisibilitySm: env.PREFLIGHT_MIN_VISIBILITY_SM,
      minCeilingFt: env.PREFLIGHT_MIN_CEILING_FT,
      kpCaution: env.PREFLIGHT_KP_CAUTION,
    },
    tfrRadiusNm: env.PREFLIGHT_TFR_RADIUS_NM,
  }));

export type CertaConfig = z.output<typeof certaEnvSchema>;
export type PreflightThresholds = CertaConfig['thresholds'];

export function loadCertaConfig(env: Env = process.env): CertaConfig {
  return loadConfig(certaEnvSchema, env);
}
