import { readdir, readFile } from 'node:fs/promises';
import type { Logger } from '@arkhon/shared';
import type { D1Bridge } from './bridge.js';

/** prisma/d1-migrations at the repository root (same depth from src/d1 and dist/d1). */
export const D1_MIGRATIONS_DIR = new URL('../../../../prisma/d1-migrations/', import.meta.url);

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
 * tracking row, so a file is applied completely or not at all.
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
  const rows = await db.prepare(`SELECT "name" FROM "${TRACKING_TABLE}"`).bind().raw();
  const pending = pendingMigrations(
    await readdir(dir),
    rows.map((row) => String(row[0])),
  );
  for (const name of pending) {
    const statements = splitStatements(await readFile(new URL(name, dir), 'utf8'));
    await db.batch([
      ...statements.map((sql) => db.prepare(sql).bind()),
      db
        .prepare(`INSERT INTO "${TRACKING_TABLE}" ("name", "applied_at") VALUES (?, ?)`)
        .bind(name, new Date().toISOString()),
    ]);
    logger.info({ migration: name, statements: statements.length }, 'applied D1 migration');
  }
  return pending;
}
