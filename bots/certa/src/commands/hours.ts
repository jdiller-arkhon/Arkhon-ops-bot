import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { callCerta, requireGuild, requireLink } from '../access.js';
import type { CertaContext } from '../context.js';
import { totalsEmbed } from '../embeds.js';

export const data = new SlashCommandBuilder()
  .setName('hours')
  .setDescription('Your total flights and flight time from Certa')
  .setDefaultMemberPermissions(PermissionFlagsBits.UseApplicationCommands)
  .setContexts(InteractionContextType.Guild);

export async function execute(
  interaction: ChatInputCommandInteraction,
  ctx: CertaContext,
): Promise<void> {
  requireGuild(interaction, ctx);
  const link = await requireLink(ctx, interaction.user.id);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const totals = await callCerta(ctx, 'getTotals', () => ctx.certa.getTotals(link.certaUserId));
  await interaction.editReply({ embeds: [totalsEmbed(link.displayName, totals)] });
}
