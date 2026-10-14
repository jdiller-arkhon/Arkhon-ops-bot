import { D1_BRIDGE_HOST, decodeD1Value, encodeD1Value, type D1BridgeRequest } from '@arkhon/shared';

/**
 * The subset of the D1 binding API that Prisma's D1 adapter and the migrator use, implemented over
 * HTTP to the Worker (see packages/shared/src/d1-bridge.ts). Pass it to `new PrismaD1(...)`.
 */
export interface D1BridgeStatement {
  readonly sql: string;
  readonly params: unknown[];
  run(): Promise<unknown>;
  raw(options?: { columnNames?: boolean }): Promise<unknown[][]>;
}

export interface D1Bridge {
  prepare(sql: string): { bind(...params: unknown[]): D1BridgeStatement };
  exec(sql: string): Promise<unknown>;
  batch(statements: D1BridgeStatement[]): Promise<unknown[]>;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Default bridge address inside a Cloudflare container. */
export const DEFAULT_D1_BRIDGE_URL = `http://${D1_BRIDGE_HOST}`;

export function createD1Bridge(baseUrl: string, fetchFn: FetchLike = fetch): D1Bridge {
  const url = baseUrl.replace(/\/+$/, '') + '/';

  async function call(request: D1BridgeRequest): Promise<unknown> {
    const body =
      'params' in request
        ? { ...request, params: request.params.map(encodeD1Value) }
        : request.op === 'batch'
          ? {
              op: 'batch',
              statements: request.statements.map((s) => ({
                sql: s.sql,
                params: s.params.map(encodeD1Value),
              })),
            }
          : request;
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: { ok?: boolean; result?: unknown; error?: string };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      throw new Error(`D1 bridge returned ${res.status}: ${text.slice(0, 200)}`);
    }
    // Keep D1's own message: Prisma's D1 adapter maps "UNIQUE constraint failed" etc. from it.
    if (!parsed.ok) throw new Error(parsed.error ?? `D1 bridge error (${res.status})`);
    return decodeD1Value(parsed.result);
  }

  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            sql,
            params,
            run: () => call({ op: 'run', sql, params }),
            raw: async () => (await call({ op: 'raw', sql, params })) as unknown[][],
          };
        },
      };
    },
    exec: (sql) => call({ op: 'exec', sql }),
    batch: async (statements) =>
      (await call({
        op: 'batch',
        statements: statements.map((s) => ({ sql: s.sql, params: s.params })),
      })) as unknown[],
  };
}
