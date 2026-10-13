import { isProduct, runInteraction, type CommandRegistry } from '@arkhon/shared';
import type { Interaction } from 'discord.js';
import type { OpsContext } from './context.js';
import { parseCustomId } from './ids.js';
import { handleRoleButton, isRoleChoice } from './onboarding/roles.js';
import { handleSetupButton } from './setup/session.js';
import {
  createTicketFromModal,
  handleStaffAction,
  showTicketModal,
  type StaffAction,
} from './tickets/service.js';

const STAFF_ACTIONS: Record<string, StaffAction> = {
  claim: 'claim',
  waiting: 'markWaiting',
  close: 'close',
};

/** Routes every interaction. Errors are logged and answered by runInteraction. */
export function createInteractionHandler(ctx: OpsContext, commands: CommandRegistry<OpsContext>) {
  return async (interaction: Interaction): Promise<void> => {
    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) return;
      await runInteraction(interaction, ctx.logger, () => command.execute(interaction, ctx));
      return;
    }

    if (!interaction.isButton() && !interaction.isModalSubmit()) return;
    const parsed = parseCustomId(interaction.customId);
    if (!parsed) return;

    await runInteraction(interaction, ctx.logger, async () => {
      const { feature, action, arg } = parsed;
      if (interaction.isButton()) {
        if (feature === 'ticket' && action === 'open' && isProduct(arg)) {
          return showTicketModal(interaction, arg, ctx);
        }
        const staffAction = STAFF_ACTIONS[action];
        if (feature === 'ticket' && staffAction && arg && /^\d+$/.test(arg)) {
          return handleStaffAction(interaction, staffAction, Number(arg), ctx);
        }
        if (feature === 'setup' && arg) {
          return handleSetupButton(interaction, action, arg, ctx);
        }
        if (feature === 'role' && isRoleChoice(action)) {
          return handleRoleButton(interaction, action, ctx);
        }
      } else if (feature === 'ticket' && action === 'modal' && isProduct(arg)) {
        return createTicketFromModal(interaction, arg, ctx);
      }
      throw new Error(`Unhandled component ${interaction.customId}`);
    });
  };
}
