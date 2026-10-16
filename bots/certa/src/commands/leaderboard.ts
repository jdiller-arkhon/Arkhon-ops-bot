import {
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { callCerta, requireGuild } from '../access.js';
import type { CertaContext } from '../context.js';
import { leaderboardEmbed } from '../embeds.js';

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Top 10 pilots by flight time')
  .setDefaultMemberPermissions(PermissionFlagsBits.UseApplicationCommands)
  .setContexts(InteractionContextType.Guild)
  .addStringOption((opt) =>
    opt
      .setName('period')
      .setDescription('Time period (default: this month)')
      .addChoices({ name: 'This month', value: 'month' }, { name: 'All time', value: 'all' }),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  ctx: CertaContext,
): Promise<void> {
  requireGuild(interaction, ctx);
  const period = interaction.options.getString('period') === 'all' ? 'all' : 'month';
  await interaction.deferReply();
  const entries = await callCerta(ctx, 'getLeaderboard', () =>
    ctx.certa.getLeaderboard(period, { limit: 10 }),
  );
  const title =
    period === 'month'
      ? `🏆 Flight time leaders: ${ctx.now().toFormat('LLLL yyyy')}`
      : '🏆 Flight time leaders: all time';
  await interaction.editReply({
    embeds: [leaderboardEmbed(title, entries, await ctx.store.discordIdsByCertaId())],
  });
}
