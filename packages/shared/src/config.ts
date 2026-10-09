import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { PRODUCTS, type Product } from './products.js';

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      [
        `Invalid configuration (${issues.length} problem${issues.length === 1 ? '' : 's'}):`,
        ...issues.map((issue) => `  - ${issue}`),
        'Set these in your environment or .env file. See .env.example for every variable.',
      ].join('\n'),
    );
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

export type Env = Record<string, string | undefined>;

/**
 * Validates environment variables against a zod schema and returns the parsed result.
 * Empty strings are treated as unset so `FOO=` in a .env file behaves like a missing value.
 * Throws a ConfigError listing every problem at once; callers should print it and exit.
 */
export function loadConfig<S extends z.ZodTypeAny>(schema: S, env: Env = process.env): z.output<S> {
  const cleaned: Env = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value.trim() !== '') cleaned[key] = value;
  }
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const key = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      const message =
        issue.code === 'invalid_type' && issue.received === 'undefined'
          ? 'is required but not set'
          : issue.message;
      return `${key}: ${message}`;
    });
    throw new ConfigError(issues);
  }
  return result.data as z.output<S>;
}

/**
 * Loads the nearest .env file (searching upward from `startDir`) into process.env.
 * Variables already present in the environment win. Does nothing when no file exists,
 * which is the normal case inside Docker.
 */
export function loadDotEnv(startDir: string = process.cwd()): string | undefined {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

// ---------------------------------------------------------------- reusable field schemas

export const snowflake = z
  .string()
  .regex(
    /^\d{17,20}$/,
    'must be a Discord ID (17-20 digits). Enable Developer Mode and use "Copy ID"',
  );

/** "a, b ,c" -> ["a", "b", "c"]. Missing value -> []. */
export const csvList = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * "certa=org/certa-app,argus=org/argus-app" -> { certa: "org/certa-app", argus: "org/argus-app" }.
 * Missing value -> {}.
 */
export const productRepoMap = z
  .string()
  .optional()
  .transform((value, ctx) => {
    const map: Partial<Record<Product, string>> = {};
    if (!value) return map;
    for (const raw of value.split(',')) {
      const entry = raw.trim();
      if (!entry) continue;
      const [productRaw, repoRaw] = entry.split('=').map((part) => part.trim());
      const product = PRODUCTS.find((p) => p === productRaw?.toLowerCase());
      if (!product) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${entry}" must start with one of ${PRODUCTS.join(', ')} (format product=owner/repo)`,
        });
        continue;
      }
      if (!repoRaw || !REPO_PATTERN.test(repoRaw)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${entry}" must use the format product=owner/repo`,
        });
        continue;
      }
      map[product] = repoRaw;
    }
    return map;
  });

export const booleanFlag = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((value) => value === 'true' || value === '1');

/** Variables every Arkhon bot needs. Bots extend this with their own fields. */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DISCORD_TOKEN: z.string().min(50, 'does not look like a bot token'),
  DISCORD_CLIENT_ID: snowflake,
  DISCORD_GUILD_ID: snowflake,
});

export type BaseEnv = z.output<typeof baseEnvSchema>;
