import { runInteraction, type CommandRegistry } from '@arkhon/shared';
import type { Interaction } from 'discord.js';
import type { CertaContext } from './context.js';
import { handleLogModal, handleShareButton } from './flights.js';
import { parseCustomId } from './ids.js';

/** Routes every interaction. Errors are logged and answered by runInteraction. */
export function createInteractionHandler(
  ctx: CertaContext,
  commands: CommandRegistry<CertaContext>,
) {
  return async (interaction: Interaction): Promise<void> => {
    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) return;
      await runInteraction(interaction, ctx.logger, () => command.execute(interaction, ctx));
      return;
    }
    if (interaction.isAutocomplete()) {
      const command = commands.get(interaction.commandName);
      if (!command?.autocomplete) return;
      await command.autocomplete(interaction, ctx).catch((error: unknown) => {
        ctx.logger.warn({ err: error, command: interaction.commandName }, 'autocomplete failed');
      });
      return;
    }
    if (!interaction.isButton() && !interaction.isModalSubmit()) return;
    const parsed = parseCustomId(interaction.customId);
    if (!parsed) return;
    await runInteraction(interaction, ctx.logger, async () => {
      const { feature, action, arg } = parsed;
      if (interaction.isModalSubmit() && feature === 'log' && action === 'modal') {
        return handleLogModal(interaction, arg, ctx);
      }
      if (interaction.isButton() && feature === 'log' && action === 'share') {
        return handleShareButton(interaction, arg, ctx);
      }
      throw new Error(`Unhandled component ${interaction.customId}`);
    });
  };
}
