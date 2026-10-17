#!/usr/bin/env node
// Cloudflare D1 migrations (SQLite), kept next to the PostgreSQL ones in prisma/migrations.
//
// The bot applies prisma/d1-migrations/*.sql in name order on startup when it runs on D1
// (packages/shared/src/d1-migrate.ts). After changing prisma/schema.prisma, write the next file with:
//
//   node scripts/d1-migrations.mjs new <name>    # e.g. new add_ticket_priority
//   node scripts/d1-migrations.mjs check         # exit 1 if the migrations lag the schema (CI)
//
// It replays the existing migrations into a temporary SQLite file and asks Prisma for the diff
// to prisma/.generated/d1.prisma (written by `node scripts/prisma.mjs generate`).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'prisma', 'd1-migrations');
const schema = join(root, 'prisma', '.generated', 'd1.prisma');
const bin = join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'prisma.cmd' : 'prisma',
);

function prisma(args) {
  const res = spawnSync(existsSync(bin) ? bin : 'prisma', args, {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) {
    process.stderr.write(res.stderr || res.stdout);
    process.exit(res.status ?? 1);
  }
  return res.stdout;
}

const [command, name] = process.argv.slice(2);
if (command !== 'new' && command !== 'check') {
  console.error('usage: d1-migrations.mjs new <name> | check');
  process.exit(2);
}
if (!existsSync(schema)) prisma(['generate', '--schema', join(root, 'prisma', 'schema.prisma')]);
if (!existsSync(schema)) {
  console.error('prisma/.generated/d1.prisma is missing: run `node scripts/prisma.mjs generate`');
  process.exit(1);
}

const files = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
  : [];
const tmp = mkdtempSync(join(tmpdir(), 'd1-'));
const url = `file:${join(tmp, 'replay.db')}`;
let diff;
try {
  if (files.length === 0) {
    diff = prisma(['migrate', 'diff', '--from-empty', '--to-schema-datamodel', schema, '--script']);
  } else {
    writeFileSync(join(tmp, 'replay.db'), '');
    for (const f of files) prisma(['db', 'execute', '--url', url, '--file', join(dir, f)]);
    diff = prisma([
      'migrate',
      'diff',
      '--from-url',
      url,
      '--to-schema-datamodel',
      schema,
      '--script',
    ]);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const empty = !/\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|PRAGMA)\b/i.test(diff);
if (command === 'check') {
  if (empty) {
    console.log(`D1 migrations are up to date (${files.length} files).`);
    process.exit(0);
  }
  console.error(
    'prisma/d1-migrations lags prisma/schema.prisma. Run: node scripts/d1-migrations.mjs new <name>',
  );
  process.exit(1);
}
if (!name || !/^[a-z0-9_]+$/.test(name)) {
  console.error('name must be lower_snake_case');
  process.exit(2);
}
if (empty) {
  console.log('No schema changes: nothing to write.');
  process.exit(0);
}
const next = String(files.length + 1).padStart(4, '0');
const file = join(dir, `${next}_${name}.sql`);
writeFileSync(file, diff);
console.log(`wrote ${file}`);
