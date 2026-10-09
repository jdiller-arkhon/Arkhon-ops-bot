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
    expect(config.roles.staff).toEqual({
      certa: '300000000000000001',
      argus: '300000000000000002',
    });
    expect(config.channels.home.argus).toBe('200000000000000008');
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

  it('fails fast listing each missing channel and role', () => {
    const { SUPPORT_CHANNEL_ID: _s, ARGUS_STAFF_ROLE_ID: _a, ...env } = validOpsEnv;
    expect(issuesFor(env)).toEqual([
      'SUPPORT_CHANNEL_ID: is required but not set',
      'ARGUS_STAFF_ROLE_ID: is required but not set',
    ]);
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

  it('rejects out-of-range numbers and unknown enum values', () => {
    const issues = issuesFor({ ...validOpsEnv, AUTOMOD_MENTION_LIMIT: '0', TICKET_MODE: 'forum' });
    expect(issues).toHaveLength(2);
    expect(issues.some((i) => i.startsWith('AUTOMOD_MENTION_LIMIT:'))).toBe(true);
    expect(issues.some((i) => i.startsWith('TICKET_MODE:'))).toBe(true);
  });
});
