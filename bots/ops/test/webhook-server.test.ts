import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createLogger } from '@arkhon/shared';
import { ChannelType } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOpsConfig } from '../src/config.js';
import type { OpsContext } from '../src/context.js';
import { LayoutStore } from '../src/layout.js';
import { createWebhookServer } from '../src/releases/server.js';
import { signBody } from '../src/releases/signature.js';
import { fixtureLayout, validOpsEnv } from './fixtures.js';

const config = loadOpsConfig({
  ...validOpsEnv,
  GITHUB_WEBHOOK_SECRET: 'github-secret-0123456789',
  GITHUB_RELEASE_REPOS: 'argus=arkhon/argus',
});

function fakeContext() {
  const released = new Set<string>();
  const send = vi.fn().mockResolvedValue({ id: '900000000000000001', crosspost: vi.fn() });
  const prisma = {
    opsRelease: {
      create: vi.fn(async ({ data }: { data: { product: string; version: string } }) => {
        const key = `${data.product}@${data.version}`;
        if (released.has(key)) throw Object.assign(new Error('unique'), { code: 'P2002' });
        released.add(key);
        return data;
      }),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
  };
  const channel = {
    type: ChannelType.GuildText,
    isSendable: () => true,
    isDMBased: () => false,
    send,
  };
  const client = { isReady: () => true, channels: { fetch: vi.fn().mockResolvedValue(channel) } };
  const layout = fixtureLayout();
  const ctx = {
    layout,
    config,
    logger: createLogger('test', { level: 'silent' }),
    prisma,
    client,
  } as unknown as OpsContext;
  return { ctx, send, prisma };
}

describe('release webhook server', () => {
  let server: Server;
  let base: string;
  let fake: ReturnType<typeof fakeContext>;

  beforeEach(async () => {
    fake = fakeContext();
    server = createWebhookServer(fake.ctx);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const post = (path: string, body: string, headers: Record<string, string>) =>
    fetch(base + path, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', ...headers },
    });

  it('announces a correctly signed release and pings only the product role', async () => {
    const body = JSON.stringify({ product: 'certa', version: '2.4.1', notes: '- Faster exports' });
    const res = await post('/webhooks/release', body, {
      'x-arkhon-signature': signBody(body, config.webhooks.releaseSecret),
    });
    expect(res.status).toBe(201);
    expect(fake.send).toHaveBeenCalledOnce();
    const message = fake.send.mock.calls[0]?.[0];
    expect(message.content).toBe(
      `<@&${fixtureLayout().require().roles.user.certa}> Certa v2.4.1 is out!`,
    );
    expect(message.allowedMentions).toEqual({
      roles: [fixtureLayout().require().roles.user.certa],
    });
    expect(message.embeds[0].toJSON().title).toBe('Certa v2.4.1');
  });

  it('ignores duplicate deliveries of the same version', async () => {
    const body = JSON.stringify({ product: 'certa', version: '2.4.1', notes: 'x' });
    const headers = { 'x-arkhon-signature': signBody(body, config.webhooks.releaseSecret) };
    expect((await post('/webhooks/release', body, headers)).status).toBe(201);
    const second = await post('/webhooks/release', body, headers);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ status: 'duplicate' });
    expect(fake.send).toHaveBeenCalledOnce();
  });

  it('rejects a bad signature with 401 and posts nothing', async () => {
    const body = JSON.stringify({ product: 'certa', version: '1', notes: 'x' });
    const res = await post('/webhooks/release', body, {
      'x-arkhon-signature': signBody(body, 'wrong-secret-000000'),
    });
    expect(res.status).toBe(401);
    expect(fake.send).not.toHaveBeenCalled();
  });

  it('rejects an invalid payload with 400', async () => {
    const body = JSON.stringify({ product: 'atlas', version: '1', notes: 'x' });
    const res = await post('/webhooks/release', body, {
      'x-arkhon-signature': signBody(body, config.webhooks.releaseSecret),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { issues: string[] }).issues[0]).toMatch(/^product:/);
  });

  it('accepts GitHub release webhooks for mapped repos', async () => {
    const body = JSON.stringify({
      action: 'published',
      release: {
        tag_name: 'v3.0.0',
        name: 'v3.0.0',
        body: 'Notes',
        html_url: 'https://github.com/arkhon/argus/r/3',
      },
      repository: { full_name: 'arkhon/argus' },
    });
    const res = await post('/webhooks/release', body, {
      'x-github-event': 'release',
      'x-hub-signature-256': signBody(body, 'github-secret-0123456789'),
    });
    expect(res.status).toBe(201);
    expect(fake.send.mock.calls[0]?.[0].content).toBe(
      `<@&${fixtureLayout().require().roles.user.argus}> Argus v3.0.0 is out!`,
    );
  });

  it('answers GitHub ping events and ignores unrelated events', async () => {
    const body = '{}';
    const sig = signBody(body, 'github-secret-0123456789');
    expect(
      (
        await post('/webhooks/github', body, {
          'x-github-event': 'ping',
          'x-hub-signature-256': sig,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post('/webhooks/github', body, {
          'x-github-event': 'push',
          'x-hub-signature-256': sig,
        })
      ).status,
    ).toBe(202);
  });

  it('returns 503 before the server has been set up', async () => {
    const store = new LayoutStore();
    store.apply({});
    (fake.ctx as { layout: LayoutStore }).layout = store;
    const body = JSON.stringify({ product: 'certa', version: '9.9.9', notes: 'x' });
    const res = await post('/webhooks/release', body, {
      'x-arkhon-signature': signBody(body, config.webhooks.releaseSecret),
    });
    expect(res.status).toBe(503);
    expect(fake.send).not.toHaveBeenCalled();
  });

  it('serves health and 404s', async () => {
    expect((await fetch(base + '/healthz')).status).toBe(200);
    expect((await fetch(base + '/nope')).status).toBe(404);
    expect((await fetch(base + '/webhooks/release')).status).toBe(405);
  });
});
