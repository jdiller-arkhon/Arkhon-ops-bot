import {
  ActionRowBuilder,
  InteractionContextType,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { requireGuild, requireLink } from '../access.js';
import { MISSION_TYPES, missionTypeSchema } from '../certa/types.js';
import type { CertaContext } from '../context.js';
import { ids, LOG_FIELDS } from '../ids.js';

/**
 * Discord modals hold at most five inputs, so the mission type is picked from the command's choice
 * list (shown as a dropdown) and the modal collects the other five fields. The submit is handled
 * in src/flights.ts.
 */
export const data = new SlashCommandBuilder()
  .setName('log')
  .setDescription('Log a drone flight to your Certa logbook')
  .setDefaultMemberPermissions(PermissionFlagsBits.UseApplicationCommands)
  .setContexts(InteractionContextType.Guild)
  .addStringOption((opt) =>
    opt
      .setName('mission')
      .setDescription('Mission type')
      .setRequired(true)
      .addChoices(...MISSION_TYPES.map((type) => ({ name: type, value: type }))),
  );

const row = (input: TextInputBuilder) =>
  new ActionRowBuilder<TextInputBuilder>().addComponents(input);

export async function execute(
  interaction: ChatInputCommandInteraction,
  ctx: CertaContext,
): Promise<void> {
  requireGuild(interaction, ctx);
  await requireLink(ctx, interaction.user.id);
  const mission = missionTypeSchema.parse(interaction.options.getString('mission', true));

  const modal = new ModalBuilder()
    .setCustomId(ids.logModal(mission))
    .setTitle(`Log ${mission} flight`)
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId(LOG_FIELDS.date)
          .setLabel('Date (YYYY-MM-DD)')
          .setStyle(TextInputStyle.Short)
          .setValue(ctx.now().toISODate()!)
          .setMinLength(5)
          .setMaxLength(10)
          .setRequired(true),
      ),
      row(
        new TextInputBuilder()
          .setCustomId(LOG_FIELDS.location)
          .setLabel('Location (city/site or ICAO code)')
          .setPlaceholder('e.g. Boulder, CO or KBJC (no coordinates)')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(100)
          .setRequired(true),
      ),
      row(
        new TextInputBuilder()
          .setCustomId(LOG_FIELDS.aircraft)
          .setLabel('Aircraft')
          .setPlaceholder('e.g. DJI Mavic 3 Enterprise')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(80)
          .setRequired(true),
      ),
      row(
        new TextInputBuilder()
          .setCustomId(LOG_FIELDS.duration)
          .setLabel('Flight duration (minutes)')
          .setPlaceholder('e.g. 25')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(4)
          .setRequired(true),
      ),
      row(
        new TextInputBuilder()
          .setCustomId(LOG_FIELDS.notes)
          .setLabel('Notes (optional)')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(false),
      ),
    );
  await interaction.showModal(modal);
}
