import { describe, expect, it, vi } from 'vitest';
import { emojiMatches, productFromTags } from '../src/feedback/forum.js';
import { createGithubIssue } from '../src/feedback/github.js';

const tags = [
  { id: '1', name: 'Certa' },
  { id: '2', name: 'argus' },
  { id: '3', name: 'Bug' },
];

describe('productFromTags', () => {
  it('finds the single product tag', () => {
    expect(productFromTags(['1', '3'], tags)).toBe('certa');
    expect(productFromTags(['2'], tags)).toBe('argus');
  });

  it('returns undefined for no product tag or both', () => {
    expect(productFromTags(['3'], tags)).toBeUndefined();
    expect(productFromTags(['1', '2'], tags)).toBeUndefined();
  });
});

describe('emojiMatches', () => {
  it('matches unicode, custom emoji by id or name', () => {
    expect(emojiMatches({ id: null, name: '🚀' }, '🚀')).toBe(true);
    expect(emojiMatches({ id: null, name: '👍' }, '🚀')).toBe(false);
    expect(emojiMatches({ id: '555', name: 'promote' }, '<:promote:555>')).toBe(true);
    expect(emojiMatches({ id: '555', name: 'promote' }, '555')).toBe(true);
    expect(emojiMatches({ id: '555', name: 'promote' }, ':promote:')).toBe(true);
  });
});

describe('createGithubIssue', () => {
  it('posts to the repo issues endpoint with labels', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ number: 17, html_url: 'https://github.com/a/b/issues/17' }), {
        status: 201,
      }),
    );
    const issue = await createGithubIssue(
      {
        token: 't',
        repo: 'a/b',
        title: 'Idea',
        body: 'Body',
        labels: ['certa', 'community-feedback'],
      },
      fetchMock as unknown as typeof fetch,
    );
    expect(issue).toEqual({ number: 17, url: 'https://github.com/a/b/issues/17' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/a/b/issues');
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'Idea',
      body: 'Body',
      labels: ['certa', 'community-feedback'],
    });
  });

  it('surfaces GitHub errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }));
    await expect(
      createGithubIssue(
        { token: 't', repo: 'a/b', title: 'x', body: 'y', labels: [] },
        fetchMock as unknown as typeof fetch,
      ),
    ).rejects.toThrow('GitHub issue creation failed (404): Not Found');
  });
});
