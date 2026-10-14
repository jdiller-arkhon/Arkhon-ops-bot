import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GITHUB_PATH, RELEASE_PATH } from '../../../bots/ops/src/releases/server.js';
import { MEMBER_WEBHOOK_PATH } from '../../../bots/ops/src/verification/webhook.js';
import {
  BOTS,
  botForPath,
  containerEnv,
  envFingerprint,
  missingRequired,
  workerSecrets,
} from '../src/bots.js';

const root = new URL('../../../', import.meta.url);

function envExampleKeys(): string[] {
  const text = readFileSync(new URL('.env.example', root), 'utf8');
  return [...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]!);
}

/** wrangler.jsonc without comments or trailing commas. */
function wranglerConfig(): {
  containers: { class_name: string; max_instances: number; image: string }[];
  durable_objects: { bindings: { name: string; class_name: string }[] };
  migrations: { new_sqlite_classes: string[] }[];
} {
  const text = readFileSync(new URL('deploy/cloudflare/wrangler.jsonc', root), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(text);
}

describe('Cloudflare bot deployment', () => {
  it('passes every bot setting from .env.example to the ops container', () => {
    // Fixed by the deployment (NODE_ENV, WEBHOOK_PORT) or only used by docker-compose (POSTGRES_*).
    const fixed = new Set([
      'NODE_ENV',
      'WEBHOOK_PORT',
      'POSTGRES_USER',
      'POSTGRES_PASSWORD',
      'POSTGRES_DB',
    ]);
    const expected = envExampleKeys()
      .filter((key) => !fixed.has(key))
      .sort();
    expect([...BOTS.ops.envKeys].sort()).toEqual(expected);
  });

  it('forwards exactly the routes the ops bot serves', () => {
    expect([...BOTS.ops.paths].sort()).toEqual(
      ['/healthz', GITHUB_PATH, MEMBER_WEBHOOK_PATH, RELEASE_PATH].sort(),
    );
    expect(botForPath(RELEASE_PATH)).toBe('ops');
    expect(botForPath(MEMBER_WEBHOOK_PATH)).toBe('ops');
    expect(botForPath('/')).toBeUndefined();
    expect(botForPath('/webhooks/release/extra')).toBeUndefined();
  });

  it('copies set string values and fixes NODE_ENV and WEBHOOK_PORT', () => {
    const env = containerEnv(BOTS.ops, {
      DISCORD_TOKEN: 'token',
      GITHUB_TOKEN: '',
      OPS_BOT: { not: 'a string' },
      UNRELATED: 'ignored',
      NODE_ENV: 'development',
    });
    expect(env).toEqual({ DISCORD_TOKEN: 'token', NODE_ENV: 'production', WEBHOOK_PORT: '3000' });
  });

  it('reports missing required settings and a SQLite database URL', () => {
    expect(missingRequired(BOTS.ops, { NODE_ENV: 'production' })).toEqual([...BOTS.ops.required]);
    const complete = Object.fromEntries(BOTS.ops.required.map((key) => [key, 'x']));
    expect(
      missingRequired(BOTS.ops, { ...complete, DATABASE_URL: 'postgresql://db/arkhon' }),
    ).toEqual([]);
    expect(missingRequired(BOTS.ops, { ...complete, DATABASE_URL: 'file:./dev.db' })).toEqual([
      'DATABASE_URL (must be PostgreSQL)',
    ]);
  });

  it('runs each bot as a single container bound to its Durable Object', () => {
    const config = wranglerConfig();
    for (const bot of Object.values(BOTS)) {
      const binding = config.durable_objects.bindings.find((b) => b.name === bot.binding);
      expect(binding).toBeDefined();
      const container = config.containers.find((c) => c.class_name === binding!.class_name);
      expect(container?.max_instances).toBe(1);
      expect(config.migrations.flatMap((m) => m.new_sqlite_classes)).toContain(binding!.class_name);
    }
  });
});

describe('envFingerprint', () => {
  it('is stable across key order and changes with any value', async () => {
    const a = await envFingerprint({ A: '1', B: '2' });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await envFingerprint({ B: '2', A: '1' })).toBe(a);
    expect(await envFingerprint({ A: '1', B: '3' })).not.toBe(a);
    expect(await envFingerprint({ A: '1' })).not.toBe(a);
  });
});

describe('workerSecrets', () => {
  it('keeps known non-empty bot settings, later sources winning', () => {
    const vars = { LOG_LEVEL: 'debug', TICKET_MODE: 'thread', CLOUDFLARE_API_TOKEN: 'never' };
    const secrets = {
      DISCORD_TOKEN: 'abc',
      LOG_LEVEL: 'warn',
      GITHUB_TOKEN: '  ',
      github_token: 'x',
    };
    expect(workerSecrets(vars, secrets)).toEqual({
      LOG_LEVEL: 'warn',
      TICKET_MODE: 'thread',
      DISCORD_TOKEN: 'abc',
    });
  });
});
