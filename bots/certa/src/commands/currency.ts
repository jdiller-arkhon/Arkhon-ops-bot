import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { callCerta, requireGuild, requireLink } from '../access.js';
import type { CertaContext } from '../context.js';
import { summarizeCurrency } from '../domain/currency.js';
import { currencyEmbed } from '../embeds.js';

export const data = new SlashCommandBuilder()
  .setName('currency')
  .setDescription('Your Part 107 recurrent training due date and days remaining')
  .setDefaultMemberPermissions(PermissionFlagsBits.UseApplicationCommands)
  .setContexts(InteractionContextType.Guild);

export async function execute(
  interaction: ChatInputCommandInteraction,
  ctx: CertaContext,
): Promise<void> {
  requireGuild(interaction, ctx);
  const link = await requireLink(ctx, interaction.user.id);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const status = await callCerta(ctx, 'getCurrency', () => ctx.certa.getCurrency(link.certaUserId));
  const summary = summarizeCurrency(status, ctx.now().toISODate()!);
  await interaction.editReply({ embeds: [currencyEmbed(link.displayName, summary)] });
}
