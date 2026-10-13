import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_PREFIX = 'sha256=';

/** "sha256=<hex>" HMAC-SHA256 of the raw body. Same format GitHub uses for X-Hub-Signature-256. */
export function signBody(body: string | Buffer, secret: string): string {
  return SIGNATURE_PREFIX + createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Constant-time check of a "sha256=<hex>" signature header against the raw request body.
 * Returns false for a missing, malformed or mismatched header; never throws.
 */
export function verifySignature(
  body: string | Buffer,
  header: string | string[] | undefined,
  secret: string,
): boolean {
  if (typeof header !== 'string' || !secret) return false;
  const value = header.trim();
  if (!value.toLowerCase().startsWith(SIGNATURE_PREFIX)) return false;
  const provided = value.slice(SIGNATURE_PREFIX.length).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;

  const expected = createHmac('sha256', secret).update(body).digest();
  const actual = Buffer.from(provided, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Max clock skew accepted for timestamped webhooks (seconds). */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * Timestamped variant (Stripe-style): the signature covers `${timestamp}.${body}` and the
 * timestamp must be within WEBHOOK_TOLERANCE_SECONDS of now, so a captured request cannot be
 * replayed later. Combine with event-id de-duplication for replays inside the window.
 */
export function signTimestampedBody(
  body: string | Buffer,
  timestamp: number,
  secret: string,
): string {
  return signBody(`${timestamp}.${body.toString()}`, secret);
}

export function verifyTimestampedSignature(
  body: string | Buffer,
  timestampHeader: string | string[] | undefined,
  signatureHeader: string | string[] | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (typeof timestampHeader !== 'string' || !/^\d{1,12}$/.test(timestampHeader.trim()))
    return false;
  const timestamp = Number(timestampHeader.trim());
  if (Math.abs(nowSeconds - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false;
  return verifySignature(`${timestamp}.${body.toString()}`, signatureHeader, secret);
}
