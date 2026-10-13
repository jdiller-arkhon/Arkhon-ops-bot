import { describe, expect, it } from 'vitest';
import {
  formatMemberId,
  generateMemberId,
  MEMBER_ID_ALPHABET,
  MEMBER_ID_TEST_VECTORS,
  memberIdCheckChar,
  parseMemberId,
} from '../src/member-id.js';

describe('member IDs', () => {
  it('generates well-formed IDs that validate', () => {
    for (let i = 0; i < 500; i++) {
      const id = generateMemberId();
      expect(id).toMatch(/^ARK-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
      expect(parseMemberId(id)).toEqual({ ok: true, memberId: id });
    }
  });

  it('matches the shared test vectors (kept in sync with the website)', () => {
    expect(MEMBER_ID_TEST_VECTORS[0]?.memberId).toBe('ARK-00000-00000');
    for (const { payload, memberId } of MEMBER_ID_TEST_VECTORS) {
      expect(formatMemberId(payload + memberIdCheckChar(payload))).toBe(memberId);
      expect(parseMemberId(memberId)).toEqual({ ok: true, memberId });
    }
    // Pinned so a change to the algorithm is caught here and on the website.
    expect(MEMBER_ID_TEST_VECTORS.map((v) => v.memberId)).toEqual([
      'ARK-00000-00000',
      'ARK-K7Q4M-2XR9F',
      'ARK-ZZZZZ-ZZZZ9',
      'ARK-1A2B3-C4D5M',
    ]);
  });

  it('accepts forgiving input: case, spaces, missing prefix and look-alike letters', () => {
    const id = MEMBER_ID_TEST_VECTORS[1]!.memberId; // ARK-K7Q4M-2XR9F
    const compact = id.replace(/^ARK-/, '').replace('-', '');
    expect(parseMemberId(compact.toLowerCase())).toEqual({ ok: true, memberId: id });
    expect(parseMemberId(` ark ${compact.slice(0, 5)} ${compact.slice(5)} `)).toEqual({
      ok: true,
      memberId: id,
    });
    expect(parseMemberId('ARK-OOOOO-OOOOO')).toEqual({ ok: true, memberId: 'ARK-00000-00000' });
    expect(parseMemberId('ark-iiiii-lllll').ok).toBe(parseMemberId('ARK-11111-11111').ok);
  });

  it('rejects every single-character typo', () => {
    const id = MEMBER_ID_TEST_VECTORS[1]!.memberId.replace(/^ARK-/, '').replace('-', '');
    for (let pos = 0; pos < id.length; pos++) {
      for (const ch of MEMBER_ID_ALPHABET) {
        if (ch === id[pos]) continue;
        const typo = id.slice(0, pos) + ch + id.slice(pos + 1);
        expect(parseMemberId(typo)).toEqual({ ok: false, reason: 'checksum' });
      }
    }
  });

  it('rejects swapped neighbouring characters', () => {
    const id = MEMBER_ID_TEST_VECTORS[3]!.memberId.replace(/^ARK-/, '').replace('-', '');
    for (let pos = 0; pos < id.length - 1; pos++) {
      if (id[pos] === id[pos + 1]) continue;
      const swapped = id.slice(0, pos) + id[pos + 1] + id[pos] + id.slice(pos + 2);
      expect(parseMemberId(swapped).ok, swapped).toBe(false);
    }
  });

  it('rejects wrong lengths and characters outside the alphabet', () => {
    expect(parseMemberId('ARK-1234')).toEqual({ ok: false, reason: 'format' });
    expect(parseMemberId('ARK-UUUUU-UUUUU')).toEqual({ ok: false, reason: 'format' });
    expect(parseMemberId('ARK-12345-6789!')).toEqual({ ok: false, reason: 'format' });
    expect(parseMemberId('')).toEqual({ ok: false, reason: 'format' });
  });
});
