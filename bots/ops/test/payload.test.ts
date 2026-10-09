import { ZodError } from 'zod';
import { describe, expect, it } from 'vitest';
import { formatNotes } from '../src/releases/announce.js';
import {
  displayVersion,
  parseGithubRelease,
  parseReleaseWebhook,
} from '../src/releases/payload.js';

describe('custom release payload', () => {
  it('parses a valid payload', () => {
    expect(
      parseReleaseWebhook({ product: 'argus', version: ' 1.0.0 ', notes: '- New dashboard' }),
    ).toEqual({
      product: 'argus',
      version: '1.0.0',
      notes: '- New dashboard',
      prerelease: false,
      source: 'webhook',
    });
  });

  it('rejects unknown products and missing fields', () => {
    expect(() => parseReleaseWebhook({ product: 'atlas', version: '1', notes: '' })).toThrow(
      ZodError,
    );
    expect(() => parseReleaseWebhook({ product: 'certa', notes: 'x' })).toThrow(ZodError);
  });
});

describe('GitHub release payload', () => {
  const repoMap = { certa: 'Arkhon/certa-app' };
  const event = (overrides: Record<string, unknown> = {}) => ({
    action: 'published',
    release: {
      tag_name: 'v2.5.0',
      name: 'Spring update',
      body: '## Changes\n- Faster sync',
      html_url: 'https://github.com/arkhon/certa-app/releases/tag/v2.5.0',
      draft: false,
      prerelease: false,
    },
    repository: { full_name: 'arkhon/certa-app' },
    ...overrides,
  });

  it('maps a published release from a mapped repo (case-insensitive)', () => {
    expect(parseGithubRelease(event(), repoMap)).toEqual({
      kind: 'release',
      release: {
        product: 'certa',
        version: 'v2.5.0',
        title: 'Spring update',
        notes: '## Changes\n- Faster sync',
        url: 'https://github.com/arkhon/certa-app/releases/tag/v2.5.0',
        prerelease: false,
        source: 'github',
      },
    });
  });

  it('ignores other actions and unmapped repos', () => {
    expect(parseGithubRelease(event({ action: 'edited' }), repoMap)).toEqual({
      kind: 'ignored',
      reason: 'action edited',
    });
    const unmapped = parseGithubRelease(
      event({ repository: { full_name: 'arkhon/other' } }),
      repoMap,
    );
    expect(unmapped.kind).toBe('ignored');
  });
});

describe('formatting', () => {
  it('displayVersion adds a v prefix to numeric versions only', () => {
    expect(displayVersion('1.2.3')).toBe('v1.2.3');
    expect(displayVersion('v1.2.3')).toBe('v1.2.3');
    expect(displayVersion('2026.10-beta')).toBe('v2026.10-beta');
    expect(displayVersion('nightly')).toBe('nightly');
  });

  it('formatNotes truncates to the embed limit with a link', () => {
    const long = 'x'.repeat(5000);
    const formatted = formatNotes(long, 'https://example.com/r');
    expect(formatted.length).toBeLessThanOrEqual(4096);
    expect(formatted.endsWith('[Read the full notes](https://example.com/r)')).toBe(true);
    expect(formatNotes('   ')).toBe('_No release notes provided._');
  });
});
