import { PrismaD1 } from '@prisma/adapter-d1';
import { PrismaClient } from '@prisma/client';
import { createD1Bridge } from './d1-client.js';
import { applyD1Migrations } from './d1-migrate.js';
import type { Logger } from './logger.js';

/**
 * The SQLite-provider client generated for D1 by scripts/prisma.mjs. It has the same models and
 * API as @prisma/client, so the rest of the bot keeps using the PrismaClient type. The path is
 * built at runtime so tsc does not pull the generated code into this project.
 */
const D1_CLIENT_URL = new URL('../../../prisma/.generated/d1-client/index.js', import.meta.url);

/** Where a bot's database lives: a Prisma URL, or Cloudflare D1 through the Worker bridge. */
export type DatabaseTarget =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'd1'; readonly bridgeUrl: string };

type D1ClientModule = { PrismaClient?: unknown; default?: { PrismaClient?: unknown } };
type D1Binding = ConstructorParameters<typeof PrismaD1>[0];

/**
 * Opens the bot's database: Prisma on DATABASE_URL (SQLite or PostgreSQL; migrations run before
 * start), or Cloudflare D1 through the Worker bridge, applying pending D1 migrations first.
 */
export async function openDatabase(
  database: DatabaseTarget,
  logger: Logger,
): Promise<PrismaClient> {
  if (database.kind === 'url') return new PrismaClient({ datasourceUrl: database.url });

  const bridge = createD1Bridge(database.bridgeUrl);
  const applied = await applyD1Migrations(bridge, logger);
  logger.info({ applied: applied.length }, 'D1 database ready');
  const mod = (await import(D1_CLIENT_URL.href)) as D1ClientModule;
  const D1Client = (mod.PrismaClient ?? mod.default?.PrismaClient) as
    (new (options: { adapter: PrismaD1 }) => PrismaClient) | undefined;
  if (!D1Client) throw new Error('D1 Prisma client not generated: run `pnpm db:generate`');
  return new D1Client({ adapter: new PrismaD1(bridge as unknown as D1Binding) });
}

/** True when a Prisma error is a unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
