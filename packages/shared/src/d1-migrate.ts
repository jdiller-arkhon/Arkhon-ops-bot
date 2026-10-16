import { readdir, readFile } from 'node:fs/promises';
import type { D1Bridge } from './d1-client.js';
import type { Logger } from './logger.js';

/** prisma/d1-migrations at the repository root (same depth from packages/shared/src and dist). */
export const D1_MIGRATIONS_DIR = new URL('../../../prisma/d1-migrations/', import.meta.url);

const TRACKING_TABLE = '_arkhon_d1_migrations';

/**
 * Splits a migration file (as written by scripts/d1-migrations.mjs) into statements: drops `--`
 * comment lines and splits on semicolons that end a line. D1 runs one statement per prepare().
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current: string[] = [];
  for (const line of sql.split(/\r?\n/)) {
    if (/^\s*--/.test(line)) continue;
    current.push(line);
    if (/;\s*$/.test(line)) {
      const statement = current.join('\n').trim().replace(/;\s*$/, '');
      if (statement) statements.push(statement);
      current = [];
    }
  }
  const rest = current.join('\n').trim();
  if (rest) statements.push(rest);
  return statements;
}

/** Migration files not yet applied, in name order. */
export function pendingMigrations(files: string[], applied: Iterable<string>): string[] {
  const done = new Set(applied);
  return files.filter((f) => f.endsWith('.sql') && !done.has(f)).sort();
}

/**
 * Applies new prisma/d1-migrations files. Each file runs as one D1 batch together with its
 * tracking row, so a file is applied completely or not at all. Every bot shares one D1 database
 * and runs this on startup; when two start together and the other one applies a file first, this
 * bot's batch fails on the tracking row and the file is skipped instead of failing startup.
 */
export async function applyD1Migrations(
  db: D1Bridge,
  logger: Logger,
  dir: URL = D1_MIGRATIONS_DIR,
): Promise<string[]> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS "${TRACKING_TABLE}" ("name" TEXT NOT NULL PRIMARY KEY, "applied_at" TEXT NOT NULL)`,
    )
    .bind()
    .run();
  const appliedNames = async () =>
    (await db.prepare(`SELECT "name" FROM "${TRACKING_TABLE}"`).bind().raw()).map((row) =>
      String(row[0]),
    );
  const pending = pendingMigrations(await readdir(dir), await appliedNames());
  const applied: string[] = [];
  for (const name of pending) {
    const statements = splitStatements(await readFile(new URL(name, dir), 'utf8'));
    try {
      await db.batch([
        ...statements.map((sql) => db.prepare(sql).bind()),
        db
          .prepare(`INSERT INTO "${TRACKING_TABLE}" ("name", "applied_at") VALUES (?, ?)`)
          .bind(name, new Date().toISOString()),
      ]);
    } catch (error) {
      if (!(await appliedNames()).includes(name)) throw error;
      logger.info({ migration: name }, 'D1 migration already applied by another bot');
      continue;
    }
    applied.push(name);
    logger.info({ migration: name, statements: statements.length }, 'applied D1 migration');
  }
  return applied;
}
