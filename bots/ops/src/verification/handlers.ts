import { arkhonEmbed, parseMemberId, UserFacingError } from '@arkhon/shared';
import { MessageFlags, type ButtonInteraction, type ModalSubmitInteraction } from 'discord.js';
import type { OpsContext } from '../context.js';
import { VERIFY_FIELDS } from '../ids.js';
import { requireGuildMember } from '../permissions.js';
import { CommunityApiError, type CommunityApi } from './api.js';
import { recordVerificationEvent } from './audit.js';
import { buildConfirmRow, buildVerifyModal, memberSettingsUrl } from './panel.js';
import { isAccountOldEnough } from './shield.js';
import { applyMemberLink } from './service.js';

function requireApi(ctx: OpsContext): CommunityApi {
  if (!ctx.security.api) {
    throw new UserFacingError(
      'Verification is not switched on yet. Please let a staff member know.',
    );
  }
  return ctx.security.api;
}

const ERROR_MESSAGES: Partial<Record<CommunityApiError['code'], string>> = {
  invalid_member_id: 'That member ID is not valid. Check it on arkhonindustries.com → Settings.',
  member_not_found:
    'No Arkhon account has that member ID. Check it on arkhonindustries.com → Settings.',
  member_already_linked:
    'That member ID is already linked to a different Discord account. If that is not you, open a support ticket or unlink it from your account settings.',
  discord_already_linked:
    'This Discord account is already linked to a different member ID. Unlink it from that account first.',
  rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
  not_found: 'That verification request was not found. Click **Verify membership** to start again.',
};

function apiMessage(error: unknown): string {
  if (error instanceof CommunityApiError) {
    return (
      ERROR_MESSAGES[error.code] ??
      'Arkhon’s website is not reachable right now. Please try again in a few minutes.'
    );
  }
  throw error;
}

/** Step 1: the Verify button. Runs the shield checks, then asks for the member ID. */
export async function handleVerifyStart(
  interaction: ButtonInteraction,
  ctx: OpsContext,
): Promise<void> {
  const member = requireGuildMember(interaction, ctx.config);
  const layout = ctx.layout.require();
  requireApi(ctx);
  if (member.roles.cache.has(layout.roles.verified)) {
    throw new UserFacingError(
      'You are already verified. You can unlink from your account settings on arkhonindustries.com.',
    );
  }
  if (ctx.security.raid.isLocked()) {
    await recordVerificationEvent(ctx, { type: 'blocked_lockdown', discordUserId: member.id });
    throw new UserFacingError(
      'Verification is paused for a few minutes while the team handles a surge of joins. Please try again shortly.',
    );
  }
  const { minAccountAgeDays, maxAttemptsPerHour } = ctx.config.verification;
  if (!isAccountOldEnough(member.id, minAccountAgeDays)) {
    await recordVerificationEvent(ctx, {
      type: 'blocked_age',
      discordUserId: member.id,
      detail: `Account created <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>; minimum is ${minAccountAgeDays} days.`,
    });
    throw new UserFacingError(
      `For security, Discord accounts must be at least ${minAccountAgeDays} days old to verify. If you need access sooner, contact the Arkhon team through arkhonindustries.com.`,
    );
  }
  if (!ctx.security.attempts.tryConsume(member.id)) {
    const minutes = Math.ceil(ctx.security.attempts.retryAfterMs(member.id) / 60_000);
    await recordVerificationEvent(ctx, {
      type: 'blocked_rate',
      discordUserId: member.id,
      detail: `More than ${maxAttemptsPerHour} attempts in an hour.`,
    });
    throw new UserFacingError(
      `Too many verification attempts. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    );
  }
  await interaction.showModal(buildVerifyModal());
}

/** Step 2: the member ID modal. Validates locally, then asks the website for a confirm link. */
export async function handleVerifySubmit(
  interaction: ModalSubmitInteraction,
  ctx: OpsContext,
): Promise<void> {
  const member = requireGuildMember(interaction, ctx.config);
  const api = requireApi(ctx);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const parsed = parseMemberId(interaction.fields.getTextInputValue(VERIFY_FIELDS.memberId));
  if (!parsed.ok) {
    throw new UserFacingError(
      parsed.reason === 'checksum'
        ? 'That member ID has a typo (the check character does not match). Copy it from arkhonindustries.com → Settings.'
        : 'Member IDs look like `ARK-K7Q4M-2XR9F`. Copy yours from arkhonindustries.com → Settings.',
    );
  }
  const memberId = parsed.memberId;

  const linkedElsewhere = await ctx.prisma.opsMemberLink.findUnique({ where: { memberId } });
  if (linkedElsewhere && linkedElsewhere.discordUserId !== member.id) {
    await recordVerificationEvent(ctx, {
      type: 'blocked_duplicate',
      discordUserId: member.id,
      memberId,
      detail: `Already linked to <@${linkedElsewhere.discordUserId}>.`,
    });
    throw new UserFacingError(ERROR_MESSAGES.member_already_linked as string);
  }

  let started;
  try {
    started = await api.startVerification({
      memberId,
      discordUserId: member.id,
      discordUsername: member.user.username,
    });
  } catch (error) {
    const message = apiMessage(error);
    const code = (error as CommunityApiError).code;
    await recordVerificationEvent(ctx, {
      type:
        code === 'member_already_linked' || code === 'discord_already_linked'
          ? 'blocked_duplicate'
          : 'failed',
      discordUserId: member.id,
      memberId,
      detail: `Website said: ${code}`,
    });
    throw new UserFacingError(message);
  }

  await recordVerificationEvent(ctx, { type: 'started', discordUserId: member.id, memberId });
  const expires = Math.floor(new Date(started.expiresAt).getTime() / 1000);
  await interaction.editReply({
    embeds: [
      arkhonEmbed({
        title: 'One more step',
        description: [
          `Open the link below, sign in to arkhonindustries.com as the owner of \`${memberId}\`, and approve linking **${member.user.username}**.`,
          '',
          `The link expires <t:${expires}:R>. You will get access as soon as you approve.`,
          'Did not request this? Ignore it; nothing is linked until the account owner approves.',
        ].join('\n'),
      }),
    ],
    components: [buildConfirmRow(started.confirmUrl, started.requestId)],
  });
}

/** Step 3 (fallback to the webhook): "I've approved" asks the website for the request status. */
export async function handleVerifyCheck(
  interaction: ButtonInteraction,
  requestId: string,
  ctx: OpsContext,
): Promise<void> {
  const member = requireGuildMember(interaction, ctx.config);
  const api = requireApi(ctx);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let state;
  try {
    state = await api.getVerification(requestId, member.id);
  } catch (error) {
    throw new UserFacingError(apiMessage(error));
  }
  if (state.discordUserId !== member.id)
    throw new UserFacingError(ERROR_MESSAGES.not_found as string);

  switch (state.status) {
    case 'approved':
      await applyMemberLink(
        ctx,
        {
          discordUserId: member.id,
          memberId: state.memberId,
          accountRole: state.accountRole,
          linkedAt: state.linkedAt ? new Date(state.linkedAt) : new Date(),
        },
        'check',
      );
      await interaction.editReply(`✅ You are verified as \`${state.memberId}\`. Welcome in!`);
      return;
    case 'pending':
      await interaction.editReply(
        `Not approved yet. Open the approval link, sign in, and click **Approve**. Lost it? Your member ID is at ${memberSettingsUrl(ctx.config.verification.websiteUrl)}.`,
      );
      return;
    case 'denied':
      await interaction.editReply(
        'The account owner declined this request on arkhonindustries.com. Nothing was linked.',
      );
      return;
    case 'expired':
      await interaction.editReply(
        'This request expired. Click **Verify membership** to start again.',
      );
      return;
  }
}
