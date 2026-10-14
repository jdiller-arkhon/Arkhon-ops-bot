/**
 * CI helper: writes the bot variables found in GitHub secrets/variables to a JSON file for
 * `wrangler secret bulk`. GitHub passes them as JSON in ALL_VARS and ALL_SECRETS
 * (`toJSON(vars)` / `toJSON(secrets)`); secrets win over variables. Unknown keys (such as
 * CLOUDFLARE_API_TOKEN) are never uploaded.
 *
 *   tsx deploy/cloudflare/scripts/write-secrets.ts <out.json>
 */
import { writeFileSync } from 'node:fs';
import { workerSecrets } from '../src/bots.js';

function parse(name: string): Record<string, unknown> {
  const raw = process.env[name];
  if (!raw) return {};
  const value: unknown = JSON.parse(raw);
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

const out = process.argv[2];
if (!out) {
  console.error('usage: write-secrets.ts <out.json>');
  process.exit(2);
}
const secrets = workerSecrets(parse('ALL_VARS'), parse('ALL_SECRETS'));
writeFileSync(out, JSON.stringify(secrets), { mode: 0o600 });
console.log(`wrote ${Object.keys(secrets).length} settings: ${Object.keys(secrets).join(', ')}`);
