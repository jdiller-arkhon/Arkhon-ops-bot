import { describe, expect, it, vi } from 'vitest';
import { signTimestampedBody, verifyTimestampedSignature } from '../src/releases/signature.js';
import {
  applyMemberLink,
  guardProductRoles,
  removeMemberLink,
  startLockdown,
  endLockdown,
} from '../src/verification/service.js';
import {
  accountAgeDays,
  AttemptLimiter,
  isAccountOldEnough,
  RaidShield,
  snowflakeTimestamp,
} from '../src/verification/shield.js';
import { handleMemberWebhook } from '../src/verification/webhook.js';
import { fakeMember, fakeVerificationContext, WEBHOOK_SECRET } from './verification-fakes.js';

const DISCORD_ID = '600000000000000001';
const OTHER_ID = '600000000000000002';
const MEMBER_ID = 'ARK-K7Q4M-2XR9F';

describe('timestamped webhook signatures', () => {
  const body = '{"id":"evt_1"}';
  const now = 1_800_000_000;

  it('accepts a fresh, correctly signed request', () => {
    const sig = signTimestampedBody(body, now, WEBHOOK_SECRET);
    expect(verifyTimestampedSignature(body, String(now), sig, WEBHOOK_SECRET, now + 30)).toBe(true);
  });

  it('rejects stale or future timestamps (replay protection)', () => {
    const sig = signTimestampedBody(body, now, WEBHOOK_SECRET);
    expect(verifyTimestampedSignature(body, String(now), sig, WEBHOOK_SECRET, now + 301)).toBe(
      false,
    );
    expect(verifyTimestampedSignature(body, String(now), sig, WEBHOOK_SECRET, now - 301)).toBe(
      false,
    );
  });

  it('rejects a timestamp that was changed after signing', () => {
    const sig = signTimestampedBody(body, now, WEBHOOK_SECRET);
    expect(verifyTimestampedSignature(body, String(now + 10), sig, WEBHOOK_SECRET, now + 10)).toBe(
      false,
    );
  });

  it('rejects missing or malformed timestamps', () => {
    const sig = signTimestampedBody(body, now, WEBHOOK_SECRET);
    expect(verifyTimestampedSignature(body, undefined, sig, WEBHOOK_SECRET, now)).toBe(false);
    expect(verifyTimestampedSignature(body, 'yesterday', sig, WEBHOOK_SECRET, now)).toBe(false);
  });
});

describe('alt and raid shield', () => {
  it('reads account creation time from the snowflake', () => {
    // Discord's documented example: 175928847299117063 was created 2016-04-30T11:18:25.796Z.
    expect(new Date(snowflakeTimestamp('175928847299117063')).toISOString()).toBe(
      '2016-04-30T11:18:25.796Z',
    );
    const created = snowflakeTimestamp('175928847299117063');
    expect(accountAgeDays('175928847299117063', created + 3 * 86_400_000)).toBeCloseTo(3);
    expect(isAccountOldEnough('175928847299117063', 7, created + 6 * 86_400_000)).toBe(false);
    expect(isAccountOldEnough('175928847299117063', 7, created + 8 * 86_400_000)).toBe(true);
    expect(isAccountOldEnough('175928847299117063', 0, created)).toBe(true);
  });

  it('limits attempts per user in a sliding window', () => {
    const limiter = new AttemptLimiter(3, 60_000);
    expect([0, 1, 2].map((t) => limiter.tryConsume('a', t))).toEqual([true, true, true]);
    expect(limiter.tryConsume('a', 3)).toBe(false);
    expect(limiter.tryConsume('b', 3)).toBe(true);
    expect(limiter.retryAfterMs('a', 10_000)).toBe(50_000);
    expect(limiter.tryConsume('a', 60_001)).toBe(true);
  });

  it('starts one lockdown on a join spike and lets it expire', () => {
    const shield = new RaidShield(3, 10_000, 60_000);
    expect(shield.recordJoin(0)).toBe(false);
    expect(shield.recordJoin(1000)).toBe(false);
    expect(shield.recordJoin(2000)).toBe(true);
    expect(shield.recordJoin(3000)).toBe(false); // already locked
    expect(shield.state(3000)).toMatchObject({ active: true, until: 62_000 });
    expect(shield.isLocked(62_001)).toBe(false);
  });

  it('ignores joins spread out over time', () => {
    const shield = new RaidShield(3, 10_000, 60_000);
    expect([0, 11_000, 22_000, 33_000].some((t) => shield.recordJoin(t))).toBe(false);
  });
});

describe('member links', () => {
  it('links once, grants Verified, DMs the member, and logs to mod-log', async () => {
    const f = fakeVerificationContext();
    const member = fakeMember(DISCORD_ID);
    f.members.set(DISCORD_ID, member);
    const link = {
      discordUserId: DISCORD_ID,
      memberId: MEMBER_ID,
      accountRole: 'pilot',
      linkedAt: new Date(),
    };

    expect(await applyMemberLink(f.ctx, link, 'webhook')).toBe(true);
    expect(await applyMemberLink(f.ctx, link, 'check')).toBe(false); // second delivery is a no-op

    expect(member.roles.cache.has(f.roles.verified)).toBe(true);
    expect(member.send).toHaveBeenCalledTimes(1);
    expect(f.events.filter((e) => e.type === 'linked')).toHaveLength(1);
    expect(f.modLog).toHaveBeenCalledTimes(1);
    expect(f.links.get(DISCORD_ID)?.memberId).toBe(MEMBER_ID);
  });

  it('moves a member ID to a new Discord account and strips the old one', async () => {
    const f = fakeVerificationContext();
    const oldMember = fakeMember(OTHER_ID);
    const newMember = fakeMember(DISCORD_ID);
    f.members.set(OTHER_ID, oldMember);
    f.members.set(DISCORD_ID, newMember);
    await applyMemberLink(
      f.ctx,
      { discordUserId: OTHER_ID, memberId: MEMBER_ID, accountRole: null, linkedAt: new Date() },
      'webhook',
    );
    oldMember.roles.cache.add(f.roles.user.certa);

    await applyMemberLink(
      f.ctx,
      { discordUserId: DISCORD_ID, memberId: MEMBER_ID, accountRole: null, linkedAt: new Date() },
      'webhook',
    );

    expect(f.links.has(OTHER_ID)).toBe(false);
    expect(f.links.get(DISCORD_ID)?.memberId).toBe(MEMBER_ID);
    expect(oldMember.roles.cache.has(f.roles.verified)).toBe(false);
    expect(oldMember.roles.cache.has(f.roles.user.certa)).toBe(false);
    expect(newMember.roles.cache.has(f.roles.verified)).toBe(true);
  });

  it('unlink removes Verified and product roles, and tells the website when staff unlink', async () => {
    const unlink = vi.fn(async () => ({ unlinked: true }));
    const f = fakeVerificationContext({ api: { unlink } });
    const member = fakeMember(DISCORD_ID);
    f.members.set(DISCORD_ID, member);
    await applyMemberLink(
      f.ctx,
      { discordUserId: DISCORD_ID, memberId: MEMBER_ID, accountRole: null, linkedAt: new Date() },
      'webhook',
    );
    member.roles.cache.add(f.roles.user.argus);

    expect(
      await removeMemberLink(f.ctx, DISCORD_ID, {
        reason: 'test',
        source: 'staff',
        actorId: OTHER_ID,
        notifyWebsite: true,
      }),
    ).toBe(true);
    expect(unlink).toHaveBeenCalledWith(DISCORD_ID);
    expect([...member.roles.cache]).toEqual([]);
    expect(f.events.at(-1)).toMatchObject({ type: 'unlinked', memberId: MEMBER_ID });
  });

  it('strips product roles from unverified members but not from verified ones or staff', async () => {
    const f = fakeVerificationContext();
    const before = fakeMember(DISCORD_ID);
    const after = fakeMember(DISCORD_ID, [f.roles.user.certa]);
    await guardProductRoles(f.ctx, before as never, after as never);
    expect(after.roles.cache.has(f.roles.user.certa)).toBe(false);
    expect(f.events.at(-1)?.type).toBe('role_stripped');

    const verified = fakeMember(OTHER_ID, [f.roles.verified, f.roles.user.certa]);
    await guardProductRoles(
      f.ctx,
      fakeMember(OTHER_ID, [f.roles.verified]) as never,
      verified as never,
    );
    expect(verified.roles.cache.has(f.roles.user.certa)).toBe(true);

    const staff = fakeMember('600000000000000003', [f.roles.staff.certa, f.roles.user.certa]);
    await guardProductRoles(
      f.ctx,
      fakeMember('600000000000000003', [f.roles.staff.certa]) as never,
      staff as never,
    );
    expect(staff.roles.cache.has(f.roles.user.certa)).toBe(true);
  });
});

describe('raid lockdown', () => {
  it('pauses invites while locked and resumes them when ended', async () => {
    const f = fakeVerificationContext();
    const until = await startLockdown(f.ctx, f.guild as never, 'test', { minutes: 5 });
    expect(f.ctx.security.raid.isLocked()).toBe(true);
    expect(f.guild.setIncidentActions).toHaveBeenLastCalledWith({ invitesDisabledUntil: until });
    await endLockdown(f.ctx, f.guild as never, 'manual', OTHER_ID);
    expect(f.ctx.security.raid.isLocked()).toBe(false);
    expect(f.guild.setIncidentActions).toHaveBeenLastCalledWith({ invitesDisabledUntil: null });
    expect(f.events.map((e) => e.type)).toEqual(['lockdown_on', 'lockdown_off']);
  });
});

describe('member webhook', () => {
  const sign = (body: string, ts = Math.floor(Date.now() / 1000)) => ({
    'x-arkhon-timestamp': String(ts),
    'x-arkhon-signature': signTimestampedBody(body, ts, WEBHOOK_SECRET),
  });
  const linked = (id = 'evt_1') =>
    JSON.stringify({
      id,
      type: 'member.linked',
      occurredAt: new Date().toISOString(),
      data: {
        discordUserId: DISCORD_ID,
        memberId: MEMBER_ID,
        accountRole: 'client',
        linkedAt: new Date().toISOString(),
      },
    });

  it('applies a signed member.linked event once, ignoring replays of the same event id', async () => {
    const f = fakeVerificationContext();
    f.members.set(DISCORD_ID, fakeMember(DISCORD_ID));
    const body = linked();
    expect(await handleMemberWebhook(f.ctx, Buffer.from(body), sign(body))).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(await handleMemberWebhook(f.ctx, Buffer.from(body), sign(body))).toEqual({
      status: 200,
      body: { ok: true, duplicate: true },
    });
    expect(f.links.get(DISCORD_ID)?.accountRole).toBe('client');
  });

  it('applies member.unlinked', async () => {
    const f = fakeVerificationContext();
    const member = fakeMember(DISCORD_ID);
    f.members.set(DISCORD_ID, member);
    await handleMemberWebhook(f.ctx, Buffer.from(linked('evt_a')), sign(linked('evt_a')));
    const body = JSON.stringify({
      id: 'evt_b',
      type: 'member.unlinked',
      occurredAt: new Date().toISOString(),
      data: { discordUserId: DISCORD_ID },
    });
    expect((await handleMemberWebhook(f.ctx, Buffer.from(body), sign(body))).status).toBe(200);
    expect(f.links.has(DISCORD_ID)).toBe(false);
    expect(member.roles.cache.has(f.roles.verified)).toBe(false);
  });

  it('rejects bad signatures, stale timestamps and invalid payloads without side effects', async () => {
    const f = fakeVerificationContext();
    const body = linked();
    expect(
      (
        await handleMemberWebhook(f.ctx, Buffer.from(body), {
          ...sign(body),
          'x-arkhon-signature': 'sha256=' + '0'.repeat(64),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await handleMemberWebhook(
          f.ctx,
          Buffer.from(body),
          sign(body, Math.floor(Date.now() / 1000) - 3600),
        )
      ).status,
    ).toBe(401);
    const bad = JSON.stringify({
      id: 'x',
      type: 'member.linked',
      occurredAt: 'now',
      data: { discordUserId: 'nope' },
    });
    expect((await handleMemberWebhook(f.ctx, Buffer.from(bad), sign(bad))).status).toBe(400);
    expect(f.links.size).toBe(0);
  });
});
