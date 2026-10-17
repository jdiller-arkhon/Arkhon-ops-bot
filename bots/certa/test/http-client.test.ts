import { describe, expect, it } from 'vitest';
import {
  CertaAuthError,
  CertaInvalidLinkCodeError,
  CertaResponseError,
  CertaUnavailableError,
  CertaUserNotFoundError,
} from '../src/certa/client.js';
import { HttpCertaClient } from '../src/certa/http-client.js';
import type { FlightInput } from '../src/certa/types.js';

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: (() => Response | Promise<Response>)[]) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    return next();
  }) as typeof fetch;
  return { fn, calls };
}

const json = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function client(responses: (() => Response | Promise<Response>)[]) {
  const fake = fakeFetch(responses);
  const sleeps: number[] = [];
  const certa = new HttpCertaClient({
    baseUrl: 'https://certa.example.com/api/',
    token: 'secret-token',
    fetchFn: fake.fn,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { certa, calls: fake.calls, sleeps };
}

const flight: FlightInput = {
  date: '2026-10-09',
  location: 'KBJC',
  locationIsIcao: true,
  aircraft: 'DJI Mavic 3E',
  durationMinutes: 25,
  missionType: 'Inspection',
};

describe('HttpCertaClient', () => {
  it('sends a bearer token and validates the response', async () => {
    const { certa, calls } = client([
      json(200, { certaUserId: 'u1', displayName: 'Ava', faaCertificateNumber: '4321' }),
    ]);
    const result = await certa.redeemLinkCode('ABC123', '123456789012345678');
    expect(result).toEqual({ certaUserId: 'u1', displayName: 'Ava' });
    expect(result).not.toHaveProperty('faaCertificateNumber');
    expect(calls[0]?.url).toBe('https://certa.example.com/api/v1/discord/link-codes/redeem');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer secret-token');
    expect(headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      code: 'ABC123',
      discordUserId: '123456789012345678',
    });
  });

  it('retries 5xx with exponential backoff and reuses the idempotency key', async () => {
    const { certa, calls, sleeps } = client([
      json(503, {}),
      json(502, {}),
      json(201, { flightId: 'f1' }),
    ]);
    expect(await certa.logFlight('u1', flight)).toEqual({ flightId: 'f1' });
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([500, 1000]);
    const keys = calls.map((c) => (c.init.headers as Record<string, string>)['idempotency-key']);
    expect(new Set(keys).size).toBe(1);
  });

  it('gives up after 3 attempts', async () => {
    const { certa, calls } = client([json(500, {}), json(500, {}), json(500, {})]);
    await expect(certa.getTotals('u1')).rejects.toBeInstanceOf(CertaUnavailableError);
    expect(calls).toHaveLength(3);
  });

  it('does not retry 4xx and maps them to typed errors', async () => {
    await expect(
      client([json(404, { message: 'expired' })]).certa.redeemLinkCode('ABC123', '1'),
    ).rejects.toBeInstanceOf(CertaInvalidLinkCodeError);
    await expect(client([json(404, {})]).certa.getCurrency('u1')).rejects.toBeInstanceOf(
      CertaUserNotFoundError,
    );
    const auth = client([json(401, {})]);
    await expect(auth.certa.getTotals('u1')).rejects.toBeInstanceOf(CertaAuthError);
    expect(auth.calls).toHaveLength(1);
  });

  it('rejects responses that do not match the schema', async () => {
    await expect(
      client([json(200, { totalFlights: 'many' })]).certa.getTotals('u1'),
    ).rejects.toBeInstanceOf(CertaResponseError);
  });

  it('times out slow requests', async () => {
    const slow = () =>
      new Promise<Response>(() => {
        /* never resolves; aborted by timeout */
      });
    const fake = fakeFetch([slow, slow, slow]);
    // Make the fake honour the abort signal like real fetch.
    const fetchFn = (async (url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
        void fake.fn(url, init);
      })) as typeof fetch;
    const certa = new HttpCertaClient({
      baseUrl: 'https://x',
      token: 't',
      fetchFn,
      timeoutMs: 20,
      sleep: async () => {},
    });
    await expect(certa.getCurrency('u1')).rejects.toBeInstanceOf(CertaUnavailableError);
    expect(fake.calls).toHaveLength(3);
  });

  it('passes leaderboard period and month', async () => {
    const entry = {
      rank: 1,
      certaUserId: 'u1',
      displayName: 'Ava',
      totalMinutes: 90,
      flightCount: 2,
    };
    const { certa, calls } = client([json(200, { entries: [entry] })]);
    expect(await certa.getLeaderboard('month', { month: '2026-09' })).toEqual([entry]);
    expect(calls[0]?.url).toBe(
      'https://certa.example.com/api/v1/leaderboard?period=month&limit=10&month=2026-09',
    );
  });
});

describe('verify lookup', () => {
  const answer = (type: 'pilot' | 'aircraft', identifier: string | null) => ({
    subject: { type, id: 'x1', name: 'Sam Pilot', identifier },
    legalToFly: true,
    status: 'green',
    reasons: [],
    asOf: '2026-10-17',
    checkedAt: '2026-10-17T12:00:00Z',
    ruleSet: 'FAA Part 107 v1',
    notice: 'Advisory only.',
  });

  it('queries by registration and keeps the aircraft registration', async () => {
    const { certa, calls } = client([json(200, answer('aircraft', 'FA3ABCDEFG'))]);
    const r = await certa.verify({ kind: 'registration', value: 'FA3ABCDEFG' });
    expect(calls[0]!.url).toBe(
      'https://certa.example.com/api/v1/verify/lookup?registration=FA3ABCDEFG',
    );
    expect(r?.subject.identifier).toBe('FA3ABCDEFG');
  });

  it('drops the certificate number from pilot answers', async () => {
    const { certa } = client([json(200, answer('pilot', '4123456'))]);
    const r = await certa.verify({ kind: 'certificateNumber', value: '4123456' });
    expect(r?.subject.identifier).toBeNull();
    expect(JSON.stringify(r)).not.toContain('4123456');
  });

  it('returns null when nothing matches', async () => {
    const { certa } = client([json(404, { message: 'not found' })]);
    expect(await certa.verify({ kind: 'serialNumber', value: 'ZZ1' })).toBeNull();
  });
});
