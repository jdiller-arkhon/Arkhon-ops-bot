import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signBody, verifySignature } from '../src/releases/signature.js';

const secret = 'a-very-secret-value-123';
const body = JSON.stringify({ product: 'certa', version: '2.4.1', notes: '- Fixed export' });

describe('webhook signature verification', () => {
  it('accepts a correct sha256 signature', () => {
    const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    expect(signBody(body, secret)).toBe(expected);
    expect(verifySignature(body, expected, secret)).toBe(true);
    expect(verifySignature(Buffer.from(body), expected, secret)).toBe(true);
  });

  it('accepts uppercase hex and surrounding whitespace', () => {
    const header = ` ${signBody(body, secret).replace('sha256=', 'SHA256=').toUpperCase()} `;
    expect(verifySignature(body, header, secret)).toBe(true);
  });

  it('rejects a signature made with a different secret', () => {
    expect(verifySignature(body, signBody(body, 'another-secret-value'), secret)).toBe(false);
  });

  it('rejects a tampered body', () => {
    const header = signBody(body, secret);
    expect(verifySignature(body.replace('2.4.1', '9.9.9'), header, secret)).toBe(false);
  });

  it.each([
    ['missing header', undefined],
    ['empty header', ''],
    ['no prefix', createHmac('sha256', secret).update(body).digest('hex')],
    ['sha1 prefix', 'sha1=' + createHmac('sha1', secret).update(body).digest('hex')],
    ['truncated digest', signBody(body, secret).slice(0, 40)],
    ['non-hex digest', 'sha256=' + 'z'.repeat(64)],
    ['array header', [signBody(body, secret)]],
  ])('rejects %s', (_label, header) => {
    expect(verifySignature(body, header as string | string[] | undefined, secret)).toBe(false);
  });

  it('rejects everything when the secret is empty', () => {
    expect(verifySignature(body, signBody(body, ''), '')).toBe(false);
  });
});
