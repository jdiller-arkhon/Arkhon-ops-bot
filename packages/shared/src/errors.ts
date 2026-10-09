import { MessageFlags, type Interaction } from 'discord.js';
import type { Logger } from 'pino';

/** An error whose message is safe and useful to show to the user verbatim. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

export const GENERIC_FAILURE_MESSAGE =
  'Something went wrong while handling that. The team has been notified.';

/** Short identifier for an interaction, used in logs: "/mod warn", "button:ops:ticket:claim". */
export function describeInteraction(interaction: Interaction): string {
  if (interaction.isChatInputCommand()) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(false);
    return ['/' + interaction.commandName, group, sub].filter(Boolean).join(' ');
  }
  if (interaction.isCommand()) return `/${interaction.commandName}`;
  if (interaction.isButton()) return `button:${stripArgs(interaction.customId)}`;
  if (interaction.isModalSubmit()) return `modal:${stripArgs(interaction.customId)}`;
  if (interaction.isAnySelectMenu()) return `select:${stripArgs(interaction.customId)}`;
  if (interaction.isAutocomplete()) return `autocomplete:${interaction.commandName}`;
  return `interaction:${(interaction as { type: number }).type}`;
}

/** Custom ids look like "ops:ticket:claim:42"; drop trailing numeric/id args for log grouping. */
function stripArgs(customId: string): string {
  return customId
    .split(':')
    .filter((part) => !/^\d+$/.test(part))
    .join(':');
}

/**
 * Global interaction error handler: logs the error and replies ephemerally with a short message.
 * Never throws.
 */
export async function handleInteractionError(
  interaction: Interaction,
  error: unknown,
  logger: Logger,
): Promise<void> {
  const name = describeInteraction(interaction);
  const userFacing = error instanceof UserFacingError;
  if (userFacing) {
    logger.info(
      { interaction: name, userId: interaction.user.id, reason: error.message },
      'interaction rejected',
    );
  } else {
    logger.error(
      { err: error, interaction: name, userId: interaction.user.id },
      'interaction failed',
    );
  }

  if (!interaction.isRepliable()) return;
  const content = userFacing ? error.message : GENERIC_FAILURE_MESSAGE;
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch (replyError) {
    logger.warn({ err: replyError, interaction: name }, 'could not send error reply');
  }
}

/**
 * Runs an interaction handler, logging command name, user id and duration, and routing any
 * error through handleInteractionError.
 */
export async function runInteraction(
  interaction: Interaction,
  logger: Logger,
  handler: () => Promise<void>,
): Promise<void> {
  const started = performance.now();
  const name = describeInteraction(interaction);
  let ok = true;
  try {
    await handler();
  } catch (error) {
    ok = false;
    await handleInteractionError(interaction, error, logger);
  } finally {
    logger.info(
      {
        interaction: name,
        userId: interaction.user.id,
        guildId: interaction.guildId,
        durationMs: Math.round(performance.now() - started),
        ok,
      },
      'interaction handled',
    );
  }
}
