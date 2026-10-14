/**
 * Wire format between a bot container and its Worker for Cloudflare D1.
 *
 * On Cloudflare the bot runs in a container, which cannot hold a D1 binding. The Worker can, so it
 * answers plain HTTP requests the container sends to http://d1.internal (intercepted by the Worker,
 * never public) and runs them against its `DB` binding. The container wraps that in an object with
 * the D1 binding methods Prisma's D1 adapter uses (bots/ops/src/d1/bridge.ts); the Worker side is
 * deploy/cloudflare/src/d1-bridge.ts. Runtime-neutral: works in Node and in Workers.
 */

export const D1_BRIDGE_HOST = 'd1.internal';

export type D1BridgeOp = 'run' | 'raw' | 'exec' | 'batch';

export interface D1BridgeStatement {
  sql: string;
  params: unknown[];
}

export type D1BridgeRequest =
  | { op: 'run' | 'raw'; sql: string; params: unknown[] }
  | { op: 'exec'; sql: string }
  | { op: 'batch'; statements: D1BridgeStatement[] };

export type D1BridgeResponse = { ok: true; result: unknown } | { ok: false; error: string };

const BYTES = '$d1bytes';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Makes a parameter or result value JSON-safe (bytes and bigints have no JSON form). */
export function encodeD1Value(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (value instanceof ArrayBuffer) return { [BYTES]: toBase64(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value)) {
    return {
      [BYTES]: toBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)),
    };
  }
  if (Array.isArray(value)) return value.map(encodeD1Value);
  return value;
}

/** Reverses encodeD1Value; byte values come back as ArrayBuffer, as D1 returns them. */
export function decodeD1Value(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeD1Value);
  if (value && typeof value === 'object' && BYTES in value) {
    const bytes = fromBase64(String((value as Record<string, unknown>)[BYTES]));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  return value;
}

/** Validates an incoming request body; returns undefined for anything malformed. */
export function parseD1BridgeRequest(body: unknown): D1BridgeRequest | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  const isStatement = (s: unknown): s is D1BridgeStatement =>
    !!s &&
    typeof s === 'object' &&
    typeof (s as D1BridgeStatement).sql === 'string' &&
    Array.isArray((s as D1BridgeStatement).params);
  switch (b.op) {
    case 'run':
    case 'raw':
      return typeof b.sql === 'string' && Array.isArray(b.params)
        ? { op: b.op, sql: b.sql, params: b.params.map(decodeD1Value) }
        : undefined;
    case 'exec':
      return typeof b.sql === 'string' ? { op: 'exec', sql: b.sql } : undefined;
    case 'batch':
      return Array.isArray(b.statements) && b.statements.every(isStatement)
        ? {
            op: 'batch',
            statements: b.statements.map((s) => ({
              sql: s.sql,
              params: s.params.map(decodeD1Value),
            })),
          }
        : undefined;
    default:
      return undefined;
  }
}
