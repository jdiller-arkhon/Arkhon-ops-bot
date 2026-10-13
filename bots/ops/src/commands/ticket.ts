import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { OpsContext } from '../context.js';
import { requireStaff } from '../permissions.js';
import { buildTicketStatsEmbed } from '../tickets/stats-query.js';

export const data = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Support ticket tools')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('stats')
      .setDescription('Open tickets per product and median response/close times (staff only)')
      .addIntegerOption((opt) =>
        opt
          .setName('days')
          .setDescription('Window for the median calculations (default 30)')
          .setMinValue(1)
          .setMaxValue(365),
      ),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  ctx: OpsContext,
): Promise<void> {
  requireStaff(interaction, ctx);
  const sub = interaction.options.getSubcommand();
  if (sub === 'stats') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const days = interaction.options.getInteger('days') ?? 30;
    await interaction.editReply({ embeds: [await buildTicketStatsEmbed(ctx, days)] });
    return;
  }
  throw new Error(`Unknown /ticket subcommand ${sub}`);
}
