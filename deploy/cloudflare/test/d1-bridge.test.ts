import { describe, expect, it } from 'vitest';
import { createD1Bridge } from '../../../bots/ops/src/d1/bridge.js';
import {
  decodeD1Value,
  encodeD1Value,
  parseD1BridgeRequest,
} from '../../../packages/shared/src/d1-bridge.js';
import { handleD1BridgeRequest, type D1Like } from '../src/d1-bridge.js';

interface Call {
  op: string;
  sql: string;
  params: unknown[];
}

/** A D1 stand-in that records calls, returns canned rows and can fail with a D1 message. */
function fakeD1(rows: unknown[][] = [], fail?: string): D1Like & { calls: Call[] } {
  const calls: Call[] = [];
  const check = () => {
    if (fail) throw new Error(fail);
  };
  return {
    calls,
    prepare: (sql) => ({
      bind: (...params) => ({
        run: async () => {
          calls.push({ op: 'run', sql, params });
          check();
          return { success: true, meta: { changes: 1, last_row_id: 7 } };
        },
        raw: async () => {
          calls.push({ op: 'raw', sql, params });
          check();
          return rows;
        },
      }),
    }),
    exec: async (sql) => {
      calls.push({ op: 'exec', sql, params: [] });
      check();
      return { count: 1 };
    },
    batch: async (statements) => {
      calls.push({ op: 'batch', sql: '', params: [statements.length] });
      check();
      return statements.map(() => ({ success: true }));
    },
  };
}

function connect(db: D1Like) {
  return createD1Bridge('http://d1.internal', (url, init) =>
    handleD1BridgeRequest(new Request(url, init), db),
  );
}

describe('D1 bridge wire format', () => {
  it('round-trips bytes and makes bigints JSON-safe', () => {
    const bytes = new Uint8Array([0, 1, 254, 255]);
    const wire = JSON.parse(JSON.stringify(encodeD1Value([bytes, 5n, 2n ** 60n, 'x', null])));
    const [b, small, big, s, n] = decodeD1Value(wire) as unknown[];
    expect(new Uint8Array(b as ArrayBuffer)).toEqual(bytes);
    expect([small, big, s, n]).toEqual([5, (2n ** 60n).toString(), 'x', null]);
  });

  it('rejects malformed requests', () => {
    expect(parseD1BridgeRequest({ op: 'run', sql: 'SELECT 1' })).toBeUndefined();
    expect(parseD1BridgeRequest({ op: 'drop', sql: 'x', params: [] })).toBeUndefined();
    expect(parseD1BridgeRequest({ op: 'batch', statements: [{ sql: 1 }] })).toBeUndefined();
    expect(parseD1BridgeRequest(null)).toBeUndefined();
  });
});

describe('D1 bridge client and Worker handler', () => {
  it('runs statements with their parameters', async () => {
    const db = fakeD1([
      ['id', 'data'],
      [1, new Uint8Array([9]).buffer],
    ]);
    const bridge = connect(db);
    const rows = await bridge
      .prepare('SELECT ?')
      .bind(1, new Uint8Array([3, 4]))
      .raw();
    expect(rows[0]).toEqual(['id', 'data']);
    expect(new Uint8Array(rows[1]![1] as ArrayBuffer)).toEqual(new Uint8Array([9]));
    expect(await bridge.prepare('UPDATE t SET a = ?').bind('b').run()).toMatchObject({
      meta: { changes: 1 },
    });
    await bridge.exec('PRAGMA foreign_keys = ON');
    expect(
      await bridge.batch([bridge.prepare('A').bind(), bridge.prepare('B').bind(1)]),
    ).toHaveLength(2);

    expect(db.calls.map((c) => c.op)).toEqual(['raw', 'run', 'exec', 'batch']);
    expect(new Uint8Array(db.calls[0]!.params[1] as ArrayBuffer)).toEqual(new Uint8Array([3, 4]));
    expect(db.calls[1]!.params).toEqual(['b']);
  });

  it("passes D1's error message through, so Prisma can map it", async () => {
    const bridge = connect(fakeD1([], 'UNIQUE constraint failed: ops_member_links.discordId'));
    await expect(bridge.prepare('INSERT').bind().run()).rejects.toThrow(
      'UNIQUE constraint failed: ops_member_links.discordId',
    );
  });

  it('answers bad requests without touching the database', async () => {
    const db = fakeD1();
    const get = await handleD1BridgeRequest(new Request('http://d1.internal/'), db);
    expect(get.status).toBe(405);
    const bad = await handleD1BridgeRequest(
      new Request('http://d1.internal/', { method: 'POST', body: '{"op":"nope"}' }),
      db,
    );
    expect(bad.status).toBe(400);
    expect(db.calls).toEqual([]);
  });
});
