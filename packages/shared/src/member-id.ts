import { randomInt } from 'node:crypto';

/**
 * Arkhon member IDs: "ARK-K7Q4M-2XR9T".
 *
 * - 10 characters of Crockford Base32 (0-9, A-Z without I, L, O, U): 9 random + 1 check.
 * - The check character is Luhn mod N over the Crockford alphabet. It catches every single
 *   wrong character and nearly every swap of neighbouring characters, so typos are rejected
 *   before any lookup happens.
 * - Random, never sequential: 32^9 ≈ 3.5e13 possible IDs, so they cannot be guessed or counted.
 * - An ID identifies an account; it is not a secret. Ownership is proven separately by
 *   confirming on arkhonindustries.com while signed in.
 *
 * Input is forgiving: case, spaces, dashes and the "ARK" prefix are optional, and the
 * look-alikes O→0 and I/L→1 are corrected, per the Crockford spec.
 *
 * The website (Arkhon-Industries repo, lib/platform/member-id.ts) implements the same algorithm;
 * MEMBER_ID_TEST_VECTORS keeps the two in lockstep.
 */
export const MEMBER_ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const MEMBER_ID_PREFIX = 'ARK';
const PAYLOAD_LENGTH = 9;
const N = MEMBER_ID_ALPHABET.length; // 32

const ALIASES: Record<string, string> = { O: '0', I: '1', L: '1' };

function codePoint(ch: string): number {
  const value = MEMBER_ID_ALPHABET.indexOf(ch);
  if (value < 0) throw new Error(`invalid member ID character "${ch}"`);
  return value;
}

/** Luhn mod N check character for a Crockford Base32 payload. */
export function memberIdCheckChar(payload: string): string {
  let factor = 2;
  let sum = 0;
  for (let i = payload.length - 1; i >= 0; i--) {
    let addend = factor * codePoint(payload[i] as string);
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / N) + (addend % N);
    sum += addend;
  }
  return MEMBER_ID_ALPHABET[(N - (sum % N)) % N] as string;
}

function isValidCheck(code: string): boolean {
  let factor = 1;
  let sum = 0;
  for (let i = code.length - 1; i >= 0; i--) {
    let addend = factor * codePoint(code[i] as string);
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / N) + (addend % N);
    sum += addend;
  }
  return sum % N === 0;
}

/** "K7Q4M2XR9T" -> "ARK-K7Q4M-2XR9T" */
export function formatMemberId(code: string): string {
  return `${MEMBER_ID_PREFIX}-${code.slice(0, 5)}-${code.slice(5)}`;
}

/** A new random member ID, formatted. Uses a CSPRNG. */
export function generateMemberId(random: (max: number) => number = randomInt): string {
  let payload = '';
  for (let i = 0; i < PAYLOAD_LENGTH; i++) payload += MEMBER_ID_ALPHABET[random(N)];
  return formatMemberId(payload + memberIdCheckChar(payload));
}

export type MemberIdParseResult =
  { ok: true; memberId: string } | { ok: false; reason: 'format' | 'checksum' };

/**
 * Normalizes user input and validates length, alphabet and check character.
 * Returns the canonical "ARK-XXXXX-XXXXX" form.
 */
export function parseMemberId(input: string): MemberIdParseResult {
  let raw = input.toUpperCase().replace(/[\s\-_.]/g, '');
  if (raw.startsWith(MEMBER_ID_PREFIX)) raw = raw.slice(MEMBER_ID_PREFIX.length);
  raw = [...raw].map((ch) => ALIASES[ch] ?? ch).join('');
  if (raw.length !== PAYLOAD_LENGTH + 1) return { ok: false, reason: 'format' };
  if (![...raw].every((ch) => MEMBER_ID_ALPHABET.includes(ch)))
    return { ok: false, reason: 'format' };
  if (!isValidCheck(raw)) return { ok: false, reason: 'checksum' };
  return { ok: true, memberId: formatMemberId(raw) };
}

/** Known-good IDs shared with the website's test suite so both implementations agree. */
export const MEMBER_ID_TEST_VECTORS: { payload: string; memberId: string }[] = [
  { payload: '000000000', memberId: 'ARK-00000-00000' },
  { payload: 'K7Q4M2XR9', memberId: 'ARK-K7Q4M-2XR9F' },
  { payload: 'ZZZZZZZZZ', memberId: 'ARK-ZZZZZ-ZZZZ9' },
  { payload: '1A2B3C4D5', memberId: 'ARK-1A2B3-C4D5M' },
];
