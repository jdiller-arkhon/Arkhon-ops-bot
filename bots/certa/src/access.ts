import { UserFacingError } from '@arkhon/shared';
import type { Interaction } from 'discord.js';
import {
  CertaAuthError,
  CertaInvalidLinkCodeError,
  CertaRejectedError,
  CertaResponseError,
  CertaUnavailableError,
  CertaUserNotFoundError,
} from './certa/client.js';
import type { CertaContext } from './context.js';
import type { Link } from './store.js';

export const NOT_LINKED_MESSAGE =
  "Your Discord account isn't linked to Certa yet. In the Certa app, open **Settings → Discord** " +
  'to get a one-time code, then run `/certa link code:<code>`.';

/** Commands work only inside the configured Arkhon server. */
export function requireGuild(interaction: Interaction, ctx: CertaContext): void {
  if (!interaction.inGuild() || interaction.guildId !== ctx.config.discord.guildId) {
    throw new UserFacingError('This only works inside the Arkhon server.');
  }
}

/** The caller's Certa link, or a user-facing "not linked" error. */
export async function requireLink(ctx: CertaContext, discordUserId: string): Promise<Link> {
  const link = await ctx.store.getLink(discordUserId);
  if (!link) throw new UserFacingError(NOT_LINKED_MESSAGE);
  return link;
}

/**
 * Runs a Certa API call and turns its typed errors into messages the pilot can act on.
 * Integration problems (bad token, unexpected responses) are logged for the team.
 */
export async function callCerta<T>(
  ctx: CertaContext,
  action: string,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof CertaInvalidLinkCodeError) {
      throw new UserFacingError(
        "That link code isn't valid. Codes are single-use and expire; generate a new one in the Certa app and try again.",
      );
    }
    if (error instanceof CertaUserNotFoundError) {
      throw new UserFacingError(
        'Your linked Certa account could not be found. Run `/certa unlink`, then link again with a new code.',
      );
    }
    if (error instanceof CertaRejectedError) {
      throw new UserFacingError(
        `Certa rejected that request${error.detail ? `: ${error.detail}` : '.'}`,
      );
    }
    if (error instanceof CertaUnavailableError) {
      ctx.logger.warn({ err: error, action }, 'Certa API unavailable');
      throw new UserFacingError(
        'Certa is not responding right now. Please try again in a few minutes.',
      );
    }
    if (error instanceof CertaAuthError || error instanceof CertaResponseError) {
      ctx.logger.error({ err: error, action }, 'Certa API integration error');
      throw new UserFacingError(
        'The Certa integration is misconfigured. The team has been notified.',
      );
    }
    throw error;
  }
}
