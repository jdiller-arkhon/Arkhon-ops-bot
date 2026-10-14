import { ConfigError } from '@arkhon/shared';
import { describe, expect, it } from 'vitest';
import { loadOpsConfig } from '../src/config.js';
import { validOpsEnv } from './fixtures.js';

function issuesFor(env: Record<string, string | undefined>): string[] {
  try {
    loadOpsConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).issues;
  }
  throw new Error('expected a ConfigError');
}

describe('ops config', () => {
  it('builds a structured config with defaults', () => {
    const config = loadOpsConfig(validOpsEnv);
    expect(config.discord.guildId).toBe('100000000000000002');
    expect(config.layoutOverrides['role.certaStaff']).toBe('300000000000000001');
    expect(config.layoutOverrides['channel.argusGeneral']).toBe('200000000000000008');
    expect(config.tickets).toEqual({ mode: 'thread', categoryId: undefined });
    expect(config.automod).toEqual({ mentionLimit: 5, keywords: [] });
    expect(config.webhooks.port).toBe(3000);
    expect(config.webhooks.githubReleaseRepos).toEqual({});
    expect(config.feedback.promoteEmoji).toBe('🚀');
  });

  it('parses lists, numbers and repo maps', () => {
    const config = loadOpsConfig({
      ...validOpsEnv,
      AUTOMOD_KEYWORDS: 'scam*, free nitro',
      AUTOMOD_MENTION_LIMIT: '8',
      WEBHOOK_PORT: '8080',
      TICKET_MODE: 'channel',
      TICKET_CATEGORY_ID: '400000000000000001',
      GITHUB_WEBHOOK_SECRET: 'github-secret-0123456789',
      GITHUB_RELEASE_REPOS: 'certa=arkhon/certa',
      GITHUB_TOKEN: 'ghp_example',
      GITHUB_FEEDBACK_REPOS: 'certa=arkhon/certa-feedback,argus=arkhon/argus-feedback',
    });
    expect(config.automod).toEqual({ mentionLimit: 8, keywords: ['scam*', 'free nitro'] });
    expect(config.webhooks.port).toBe(8080);
    expect(config.tickets).toEqual({ mode: 'channel', categoryId: '400000000000000001' });
    expect(config.webhooks.githubReleaseRepos).toEqual({ certa: 'arkhon/certa' });
    expect(config.feedback.repos).toEqual({
      certa: 'arkhon/certa-feedback',
      argus: 'arkhon/argus-feedback',
    });
  });

  it('runs without any channel or role ids (they come from /setup server)', () => {
    const minimal = {
      DISCORD_TOKEN: validOpsEnv.DISCORD_TOKEN,
      DISCORD_CLIENT_ID: validOpsEnv.DISCORD_CLIENT_ID,
      DISCORD_GUILD_ID: validOpsEnv.DISCORD_GUILD_ID,
      DATABASE_URL: validOpsEnv.DATABASE_URL,
      RELEASE_WEBHOOK_SECRET: validOpsEnv.RELEASE_WEBHOOK_SECRET,
    };
    expect(loadOpsConfig(minimal).layoutOverrides).toEqual({});
  });

  it('fails fast listing each missing required variable', () => {
    const { DISCORD_GUILD_ID: _g, RELEASE_WEBHOOK_SECRET: _r, ...env } = validOpsEnv;
    expect(issuesFor(env)).toEqual([
      'DISCORD_GUILD_ID: is required but not set',
      'RELEASE_WEBHOOK_SECRET: is required but not set',
    ]);
  });

  it('still validates channel and role overrides when they are set', () => {
    expect(issuesFor({ ...validOpsEnv, SUPPORT_CHANNEL_ID: '#support' })[0]).toMatch(
      /^SUPPORT_CHANNEL_ID: must be a Discord ID/,
    );
  });

  it('requires a long enough release webhook secret', () => {
    expect(issuesFor({ ...validOpsEnv, RELEASE_WEBHOOK_SECRET: 'short' })).toEqual([
      'RELEASE_WEBHOOK_SECRET: must be at least 16 characters',
    ]);
  });

  it('requires GITHUB_WEBHOOK_SECRET when release repos are mapped', () => {
    expect(issuesFor({ ...validOpsEnv, GITHUB_RELEASE_REPOS: 'certa=arkhon/certa' })).toEqual([
      'GITHUB_WEBHOOK_SECRET: is required when GITHUB_RELEASE_REPOS is set',
    ]);
  });

  it('requires GITHUB_TOKEN when feedback repos are mapped', () => {
    expect(issuesFor({ ...validOpsEnv, GITHUB_FEEDBACK_REPOS: 'argus=arkhon/argus' })).toEqual([
      'GITHUB_TOKEN: is required when GITHUB_FEEDBACK_REPOS is set',
    ]);
  });

  it('uses DATABASE_URL, or the D1 bridge on Cloudflare, but never both or neither', () => {
    expect(loadOpsConfig(validOpsEnv).database).toEqual({
      kind: 'url',
      url: validOpsEnv.DATABASE_URL,
    });
    const { DATABASE_URL: _d, ...noUrl } = validOpsEnv;
    expect(loadOpsConfig({ ...noUrl, D1_BRIDGE_URL: 'http://d1.internal' }).database).toEqual({
      kind: 'd1',
      bridgeUrl: 'http://d1.internal',
    });
    expect(issuesFor(noUrl)).toEqual([
      'DATABASE_URL: is required (or D1_BRIDGE_URL on Cloudflare)',
    ]);
    expect(issuesFor({ ...validOpsEnv, D1_BRIDGE_URL: 'http://d1.internal' })).toEqual([
      'DATABASE_URL: set DATABASE_URL or D1_BRIDGE_URL, not both',
    ]);
  });

  it('rejects out-of-range numbers and unknown enum values', () => {
    const issues = issuesFor({ ...validOpsEnv, AUTOMOD_MENTION_LIMIT: '0', TICKET_MODE: 'forum' });
    expect(issues).toHaveLength(2);
    expect(issues.some((i) => i.startsWith('AUTOMOD_MENTION_LIMIT:'))).toBe(true);
    expect(issues.some((i) => i.startsWith('TICKET_MODE:'))).toBe(true);
  });
});
