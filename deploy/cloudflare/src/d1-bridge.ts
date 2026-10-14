/**
 * Worker side of the D1 bridge (protocol in packages/shared/src/d1-bridge.ts). The bot container
 * sends its queries to http://d1.internal; OpsBot.outboundByHost routes them here, and they run
 * against the Worker's D1 binding. Errors return D1's own message, which Prisma's D1 adapter maps
 * to Prisma error codes (e.g. "UNIQUE constraint failed" -> P2002).
 */
import {
  encodeD1Value,
  parseD1BridgeRequest,
  type D1BridgeResponse,
} from '../../../packages/shared/src/d1-bridge.js';

/** The subset of D1Database used here, so tests can pass a fake. */
export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      raw(options: { columnNames: true }): Promise<unknown[][]>;
    };
  };
  exec(sql: string): Promise<unknown>;
  batch(statements: unknown[]): Promise<unknown[]>;
}

function json(body: D1BridgeResponse, status = 200): Response {
  return Response.json(body, { status });
}

export async function handleD1BridgeRequest(request: Request, db: D1Like): Promise<Response> {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid JSON' }, 400);
  }
  const op = parseD1BridgeRequest(body);
  if (!op) return json({ ok: false, error: 'invalid D1 bridge request' }, 400);
  try {
    let result: unknown;
    switch (op.op) {
      case 'run':
        result = await db
          .prepare(op.sql)
          .bind(...op.params)
          .run();
        break;
      case 'raw':
        result = await db
          .prepare(op.sql)
          .bind(...op.params)
          .raw({ columnNames: true });
        break;
      case 'exec':
        result = await db.exec(op.sql);
        break;
      case 'batch':
        result = await db.batch(op.statements.map((s) => db.prepare(s.sql).bind(...s.params)));
        break;
    }
    return json({ ok: true, result: encodeD1Value(result) });
  } catch (error) {
    // 200 with ok:false: the request reached D1 and D1 refused it; the client throws the message.
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
