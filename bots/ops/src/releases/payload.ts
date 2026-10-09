import { PRODUCTS, type Product } from '@arkhon/shared';
import { z } from 'zod';

export interface Release {
  product: Product;
  version: string;
  notes: string;
  url?: string;
  title?: string;
  prerelease: boolean;
  source: 'webhook' | 'github';
}

export const releaseWebhookSchema = z.object({
  product: z.enum(PRODUCTS),
  version: z.string().trim().min(1).max(64),
  notes: z.string().max(50_000),
  url: z.string().url().optional(),
});

export function parseReleaseWebhook(body: unknown): Release {
  const data = releaseWebhookSchema.parse(body);
  return { ...data, prerelease: false, source: 'webhook' };
}

const githubReleaseEventSchema = z.object({
  action: z.string(),
  release: z.object({
    tag_name: z.string().min(1),
    name: z.string().nullable().optional(),
    body: z.string().nullable().optional(),
    html_url: z.string().url(),
    draft: z.boolean().optional(),
    prerelease: z.boolean().optional(),
  }),
  repository: z.object({ full_name: z.string() }),
});

export type GithubReleaseResult =
  { kind: 'release'; release: Release } | { kind: 'ignored'; reason: string };

/**
 * Maps a GitHub "release" webhook to a Release when the repository is mapped to a product.
 * Only "published" releases are announced.
 */
export function parseGithubRelease(
  body: unknown,
  repoMap: Partial<Record<Product, string>>,
): GithubReleaseResult {
  const event = githubReleaseEventSchema.parse(body);
  if (event.action !== 'published') return { kind: 'ignored', reason: `action ${event.action}` };
  if (event.release.draft) return { kind: 'ignored', reason: 'draft release' };

  const repo = event.repository.full_name.toLowerCase();
  const product = PRODUCTS.find((p) => repoMap[p]?.toLowerCase() === repo);
  if (!product)
    return { kind: 'ignored', reason: `repository ${event.repository.full_name} is not mapped` };

  const name = event.release.name?.trim();
  return {
    kind: 'release',
    release: {
      product,
      version: event.release.tag_name,
      notes: event.release.body ?? '',
      url: event.release.html_url,
      ...(name && name !== event.release.tag_name ? { title: name } : {}),
      prerelease: event.release.prerelease ?? false,
      source: 'github',
    },
  };
}

/** "1.2.3" -> "v1.2.3"; leaves "v1.2.3" and non-numeric tags alone. */
export function displayVersion(version: string): string {
  return /^\d/.test(version) ? `v${version}` : version;
}
