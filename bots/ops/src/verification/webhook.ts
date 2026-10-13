import { z } from 'zod';
import type { OpsContext } from '../context.js';
import { isUniqueViolation } from '../db.js';
import { verifyTimestampedSignature } from '../releases/signature.js';
import { applyMemberLink, removeMemberLink } from './service.js';

export const MEMBER_WEBHOOK_PATH = '/webhooks/member';
export const TIMESTAMP_HEADER = 'x-arkhon-timestamp';
export const SIGNATURE_HEADER = 'x-arkhon-signature';

const snowflake = z.string().regex(/^\d{17,20}$/);
const memberWebhookSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1).max(100),
    type: z.literal('member.linked'),
    occurredAt: z.string(),
    data: z.object({
      discordUserId: snowflake,
      memberId: z.string().regex(/^ARK-[0-9A-Z]{5}-[0-9A-Z]{5}$/),
      accountRole: z.string().nullable().optional(),
      linkedAt: z.string(),
    }),
  }),
  z.object({
    id: z.string().min(1).max(100),
    type: z.literal('member.unlinked'),
    occurredAt: z.string(),
    data: z.object({
      discordUserId: snowflake,
      memberId: z.string().optional(),
      reason: z.string().max(200).optional(),
    }),
  }),
]);

export type MemberWebhookEvent = z.infer<typeof memberWebhookSchema>;

export type MemberWebhookResult =
  | { status: 401; body: { ok: false; error: string } }
  | { status: 400; body: { ok: false; error: string } }
  | { status: 200; body: { ok: true; duplicate?: boolean } };

/**
 * Handles a signed website event. Order: signature + timestamp, schema, de-duplication by event
 * id, then apply. Returns the HTTP status/body for the server to send.
 */
export async function handleMemberWebhook(
  ctx: OpsContext,
  raw: Buffer,
  headers: Record<string, string | string[] | undefined>,
): Promise<MemberWebhookResult> {
  const secret = ctx.config.verification.webhookSecret;
  if (
    !secret ||
    !verifyTimestampedSignature(raw, headers[TIMESTAMP_HEADER], headers[SIGNATURE_HEADER], secret)
  ) {
    return { status: 401, body: { ok: false, error: 'invalid signature' } };
  }
  let event: MemberWebhookEvent;
  try {
    event = memberWebhookSchema.parse(JSON.parse(raw.toString('utf8')));
  } catch {
    return { status: 400, body: { ok: false, error: 'invalid payload' } };
  }
  if (await ctx.prisma.opsWebhookEvent.findUnique({ where: { id: event.id } })) {
    return { status: 200, body: { ok: true, duplicate: true } };
  }

  if (event.type === 'member.linked') {
    await applyMemberLink(
      ctx,
      {
        discordUserId: event.data.discordUserId,
        memberId: event.data.memberId,
        accountRole: event.data.accountRole ?? null,
        linkedAt: new Date(event.data.linkedAt),
      },
      'webhook',
    );
  } else {
    // A late unlink for an older member ID must not remove a newer link.
    const current = await ctx.prisma.opsMemberLink.findUnique({
      where: { discordUserId: event.data.discordUserId },
    });
    if (!current || !event.data.memberId || current.memberId === event.data.memberId) {
      await removeMemberLink(ctx, event.data.discordUserId, {
        reason: event.data.reason ?? 'Unlinked on arkhonindustries.com',
        source: 'webhook',
        notifyWebsite: false,
      });
    }
  }
  // Recorded only once applied: a delivery that failed part-way is processed again on retry,
  // and the periodic reconciliation repairs anything a lost delivery missed.
  await ctx.prisma.opsWebhookEvent.create({ data: { id: event.id } }).catch((error: unknown) => {
    if (!isUniqueViolation(error)) throw error;
  });
  return { status: 200, body: { ok: true } };
}
