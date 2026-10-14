import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
import { createLogger } from '@arkhon/shared';
import { describe, expect, it } from 'vitest';
import type { D1Bridge, D1BridgeStatement } from '../src/d1/bridge.js';
import {
  D1_MIGRATIONS_DIR,
  applyD1Migrations,
  pendingMigrations,
  splitStatements,
} from '../src/d1/migrate.js';

const logger = createLogger('test', { level: 'silent' });

/** Records statements; SELECTs from the tracking table return the names inserted so far. */
function fakeD1(applied: string[] = []): D1Bridge & { batches: string[][] } {
  const names = [...applied];
  const batches: string[][] = [];
  const statement = (sql: string, params: unknown[]): D1BridgeStatement => ({
    sql,
    params,
    run: async () => ({ success: true }),
    raw: async () => [['name'], ...names.map((n) => [n])],
  });
  return {
    batches,
    prepare: (sql) => ({ bind: (...params) => statement(sql, params) }),
    exec: async () => ({ count: 0 }),
    batch: async (statements) => {
      batches.push(statements.map((s) => s.sql));
      for (const s of statements) {
        if (s.sql.startsWith('INSERT INTO "_arkhon_d1_migrations"'))
          names.push(String(s.params[0]));
      }
      return statements.map(() => ({ success: true }));
    },
  };
}

describe('splitStatements', () => {
  it('drops comment lines and splits on semicolons that end a line', () => {
    const sql = [
      '-- CreateTable',
      'CREATE TABLE "a" (',
      '    "id" TEXT NOT NULL PRIMARY KEY,',
      '    "note" TEXT DEFAULT \'x;y\'',
      ');',
      '',
      '-- CreateIndex',
      'CREATE UNIQUE INDEX "a_note_key" ON "a"("note");',
      '',
    ].join('\n');
    expect(splitStatements(sql)).toEqual([
      'CREATE TABLE "a" (\n    "id" TEXT NOT NULL PRIMARY KEY,\n    "note" TEXT DEFAULT \'x;y\'\n)',
      'CREATE UNIQUE INDEX "a_note_key" ON "a"("note")',
    ]);
  });

  it('keeps a final statement without a semicolon and ignores empty input', () => {
    expect(splitStatements('SELECT 1')).toEqual(['SELECT 1']);
    expect(splitStatements('-- nothing\n\n')).toEqual([]);
  });

  it('splits every committed D1 migration into statements', () => {
    for (const file of readdirSync(D1_MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))) {
      const statements = splitStatements(readFileSync(new URL(file, D1_MIGRATIONS_DIR), 'utf8'));
      expect(statements.length).toBeGreaterThan(0);
      for (const s of statements) expect(s).toMatch(/^(CREATE|ALTER|DROP|INSERT|UPDATE|PRAGMA)/);
    }
  });
});

describe('applyD1Migrations', () => {
  it('lists pending files in name order', () => {
    expect(pendingMigrations(['0002_b.sql', 'README', '0001_a.sql'], ['0001_a.sql'])).toEqual([
      '0002_b.sql',
    ]);
  });

  it('applies each new file as one batch with its tracking row, once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'd1-migrate-'));
    writeFileSync(join(dir, '0001_init.sql'), 'CREATE TABLE "a" ("id" TEXT);\n');
    writeFileSync(
      join(dir, '0002_more.sql'),
      'CREATE TABLE "b" ("id" TEXT);\nCREATE TABLE "c" ("id" TEXT);\n',
    );
    const dirUrl = pathToFileURL(dir + '/');

    const db = fakeD1(['0001_init.sql']);
    expect(await applyD1Migrations(db, logger, dirUrl)).toEqual(['0002_more.sql']);
    expect(db.batches).toEqual([
      [
        'CREATE TABLE "b" ("id" TEXT)',
        'CREATE TABLE "c" ("id" TEXT)',
        'INSERT INTO "_arkhon_d1_migrations" ("name", "applied_at") VALUES (?, ?)',
      ],
    ]);
    expect(await applyD1Migrations(db, logger, dirUrl)).toEqual([]);
    expect(db.batches).toHaveLength(1);
  });
});
