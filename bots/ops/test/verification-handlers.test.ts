import { UserFacingError } from '@arkhon/shared';
import { describe, expect, it, vi } from 'vitest';
import { CommunityApiError } from '../src/verification/api.js';
import {
  handleVerifyCheck,
  handleVerifyStart,
  handleVerifySubmit,
} from '../src/verification/handlers.js';
import { fakeMember, fakeVerificationContext } from './verification-fakes.js';

const OLD_ID = '175928847299117063'; // created 2016
const NEW_ID = String((BigInt(Date.now() - 1_420_070_400_000) << 22n) + 1n); // created just now

function interaction(member: ReturnType<typeof fakeMember>, extra: Record<string, unknown> = {}) {
  return {
    inCachedGuild: () => true,
    guildId: member.guild.id,
    member,
    user: member.user,
    showModal: vi.fn(),
    deferReply: vi.fn(),
    editReply: vi.fn(),
    ...extra,
  } as never;
}

const modal = (member: ReturnType<typeof fakeMember>, value: string) =>
  interaction(member, { fields: { getTextInputValue: () => value } });

describe('verify button', () => {
  it('opens the member ID modal for an eligible member', async () => {
    const f = fakeVerificationContext({ api: {} });
    const i = interaction(fakeMember(OLD_ID)) as { showModal: ReturnType<typeof vi.fn> };
    await handleVerifyStart(i as never, f.ctx);
    expect(i.showModal).toHaveBeenCalledOnce();
  });

  it('refuses brand-new Discord accounts and logs it', async () => {
    const f = fakeVerificationContext({ api: {} });
    await expect(handleVerifyStart(interaction(fakeMember(NEW_ID)), f.ctx)).rejects.toThrow(
      /at least 7 days old/,
    );
    expect(f.events.at(-1)?.type).toBe('blocked_age');
  });

  it('refuses during a lockdown', async () => {
    const f = fakeVerificationContext({ api: {} });
    f.ctx.security.raid.start('test');
    await expect(handleVerifyStart(interaction(fakeMember(OLD_ID)), f.ctx)).rejects.toThrow(
      /paused/,
    );
    expect(f.events.at(-1)?.type).toBe('blocked_lockdown');
  });

  it('rate limits repeated attempts', async () => {
    const f = fakeVerificationContext({ api: {} });
    const member = fakeMember(OLD_ID);
    for (let n = 0; n < 5; n++) await handleVerifyStart(interaction(member), f.ctx);
    await expect(handleVerifyStart(interaction(member), f.ctx)).rejects.toThrow(
      /Too many verification attempts/,
    );
    expect(f.events.at(-1)?.type).toBe('blocked_rate');
  });

  it('tells already-verified members and explains when verification is off', async () => {
    const f = fakeVerificationContext({ api: {} });
    await expect(
      handleVerifyStart(interaction(fakeMember(OLD_ID, [f.roles.verified])), f.ctx),
    ).rejects.toThrow(/already verified/);
    const off = fakeVerificationContext();
    await expect(handleVerifyStart(interaction(fakeMember(OLD_ID)), off.ctx)).rejects.toThrow(
      /not switched on/,
    );
  });
});

describe('member ID modal', () => {
  it('catches typos locally without calling the website', async () => {
    const startVerification = vi.fn();
    const f = fakeVerificationContext({ api: { startVerification } });
    await expect(
      handleVerifySubmit(modal(fakeMember(OLD_ID), 'ARK-K7Q4M-2XR9G'), f.ctx),
    ).rejects.toThrow(/typo/);
    await expect(handleVerifySubmit(modal(fakeMember(OLD_ID), 'hello'), f.ctx)).rejects.toThrow(
      /look like/,
    );
    expect(startVerification).not.toHaveBeenCalled();
  });

  it('starts verification and replies with the approval link', async () => {
    const startVerification = vi.fn(async () => ({
      requestId: 'vr_abc',
      confirmUrl: 'https://arkhon.test/app/community/verify?token=t',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    }));
    const f = fakeVerificationContext({ api: { startVerification } });
    const member = fakeMember(OLD_ID);
    const i = modal(member, 'ark k7q4m 2xr9f') as { editReply: ReturnType<typeof vi.fn> };
    await handleVerifySubmit(i as never, f.ctx);
    expect(startVerification).toHaveBeenCalledWith({
      memberId: 'ARK-K7Q4M-2XR9F',
      discordUserId: OLD_ID,
      discordUsername: member.user.username,
    });
    const reply = i.editReply.mock.calls[0]?.[0];
    const buttons = reply.components[0].toJSON().components;
    expect(buttons[0].url).toBe('https://arkhon.test/app/community/verify?token=t');
    expect(buttons[1].custom_id).toBe('ops:verify:check:vr_abc');
    expect(f.events.at(-1)?.type).toBe('started');
  });

  it('blocks a member ID already linked to someone else in this server', async () => {
    const startVerification = vi.fn();
    const f = fakeVerificationContext({ api: { startVerification } });
    f.links.set('600000000000000009', {
      discordUserId: '600000000000000009',
      memberId: 'ARK-K7Q4M-2XR9F',
      accountRole: null,
      linkedAt: new Date(),
    });
    await expect(
      handleVerifySubmit(modal(fakeMember(OLD_ID), 'ARK-K7Q4M-2XR9F'), f.ctx),
    ).rejects.toThrow(/already linked/);
    expect(startVerification).not.toHaveBeenCalled();
    expect(f.events.at(-1)?.type).toBe('blocked_duplicate');
  });

  it('maps website errors to clear messages', async () => {
    const startVerification = vi.fn(async () => {
      throw new CommunityApiError('member_not_found', 404, 'nope');
    });
    const f = fakeVerificationContext({ api: { startVerification } });
    const error = await handleVerifySubmit(
      modal(fakeMember(OLD_ID), 'ARK-K7Q4M-2XR9F'),
      f.ctx,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toMatch(/No Arkhon account has that member ID/);
  });
});

describe("I've approved button", () => {
  it('links the member when the website says approved', async () => {
    const getVerification = vi.fn(async () => ({
      status: 'approved' as const,
      memberId: 'ARK-K7Q4M-2XR9F',
      discordUserId: OLD_ID,
      accountRole: 'pilot',
      linkedAt: new Date().toISOString(),
    }));
    const f = fakeVerificationContext({ api: { getVerification } });
    const member = fakeMember(OLD_ID);
    f.members.set(OLD_ID, member);
    const i = interaction(member) as { editReply: ReturnType<typeof vi.fn> };
    await handleVerifyCheck(i as never, 'vr_abc', f.ctx);
    expect(getVerification).toHaveBeenCalledWith('vr_abc', OLD_ID);
    expect(member.roles.cache.has(f.roles.verified)).toBe(true);
    expect(i.editReply.mock.calls[0]?.[0]).toMatch(/You are verified/);
  });

  it('does not link while pending', async () => {
    const getVerification = vi.fn(async () => ({
      status: 'pending' as const,
      memberId: 'ARK-K7Q4M-2XR9F',
      discordUserId: OLD_ID,
      accountRole: null,
      linkedAt: null,
    }));
    const f = fakeVerificationContext({ api: { getVerification } });
    const member = fakeMember(OLD_ID);
    f.members.set(OLD_ID, member);
    const i = interaction(member) as { editReply: ReturnType<typeof vi.fn> };
    await handleVerifyCheck(i as never, 'vr_abc', f.ctx);
    expect(member.roles.cache.size).toBe(0);
    expect(i.editReply.mock.calls[0]?.[0]).toMatch(/Not approved yet/);
  });
});
