import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  baseEnvSchema,
  ConfigError,
  csvList,
  loadConfig,
  productRepoMap,
  snowflake,
} from '../src/config.js';

const TOKEN = 'x'.repeat(72);
const validBase = {
  DISCORD_TOKEN: TOKEN,
  DISCORD_CLIENT_ID: '123456789012345678',
  DISCORD_GUILD_ID: '223456789012345678',
};

function expectConfigError(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return error as ConfigError;
  }
  throw new Error('expected a ConfigError');
}

describe('loadConfig', () => {
  it('parses a valid environment and applies defaults', () => {
    const config = loadConfig(baseEnvSchema, validBase);
    expect(config).toEqual({ ...validBase, NODE_ENV: 'development', LOG_LEVEL: 'info' });
  });

  it('reports every missing variable at once with a clear message', () => {
    const error = expectConfigError(() => loadConfig(baseEnvSchema, {}));
    expect(error.issues).toEqual([
      'DISCORD_TOKEN: is required but not set',
      'DISCORD_CLIENT_ID: is required but not set',
      'DISCORD_GUILD_ID: is required but not set',
    ]);
    expect(error.message).toContain('Invalid configuration (3 problems)');
    expect(error.message).toContain('.env.example');
  });

  it('treats empty strings as unset', () => {
    const error = expectConfigError(() =>
      loadConfig(baseEnvSchema, { ...validBase, DISCORD_GUILD_ID: '  ' }),
    );
    expect(error.issues).toEqual(['DISCORD_GUILD_ID: is required but not set']);
  });

  it('rejects malformed values', () => {
    const error = expectConfigError(() =>
      loadConfig(baseEnvSchema, { ...validBase, DISCORD_CLIENT_ID: 'my-bot', NODE_ENV: 'staging' }),
    );
    expect(error.issues).toHaveLength(2);
    expect(error.issues[0]).toMatch(/^NODE_ENV: /);
    expect(error.issues[1]).toMatch(/^DISCORD_CLIENT_ID: must be a Discord ID/);
  });

  it('ignores unrelated variables', () => {
    expect(() =>
      loadConfig(baseEnvSchema, { ...validBase, PATH: '/usr/bin', HOME: '/root' }),
    ).not.toThrow();
  });
});

describe('field helpers', () => {
  it('snowflake accepts 17-20 digit ids only', () => {
    expect(snowflake.safeParse('12345678901234567').success).toBe(true);
    expect(snowflake.safeParse('12345678901234567890').success).toBe(true);
    expect(snowflake.safeParse('1234').success).toBe(false);
    expect(snowflake.safeParse('<#123456789012345678>').success).toBe(false);
  });

  it('csvList splits, trims and drops blanks', () => {
    expect(csvList.parse(' a, b ,,c ')).toEqual(['a', 'b', 'c']);
    expect(csvList.parse(undefined)).toEqual([]);
  });

  it('productRepoMap parses product=owner/repo pairs', () => {
    expect(productRepoMap.parse('certa=arkhon/certa-app, Argus=arkhon/argus.web')).toEqual({
      certa: 'arkhon/certa-app',
      argus: 'arkhon/argus.web',
    });
    expect(productRepoMap.parse(undefined)).toEqual({});
  });

  it('productRepoMap rejects unknown products and bad repos', () => {
    const schema = z.object({ MAP: productRepoMap });
    const error = expectConfigError(() =>
      loadConfig(schema, { MAP: 'atlas=arkhon/atlas,certa=not-a-repo' }),
    );
    expect(error.issues).toHaveLength(2);
    expect(error.issues[0]).toContain('"atlas=arkhon/atlas" must start with one of certa, argus');
    expect(error.issues[1]).toContain('"certa=not-a-repo" must use the format product=owner/repo');
  });
});
