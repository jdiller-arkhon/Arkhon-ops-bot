import { UserFacingError } from '@arkhon/shared';
import {
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { requireGuild } from '../access.js';
import type { CertaContext } from '../context.js';
import { buildPreflightEmbed } from '../preflight/embed.js';

const ICAO_PATTERN = /^[A-Z][A-Z0-9]{3}$/;

export const data = new SlashCommandBuilder()
  .setName('preflight')
  .setDescription('Weather, Kp index and nearby TFRs for an airport (advisory)')
  .setDefaultMemberPermissions(PermissionFlagsBits.UseApplicationCommands)
  .setContexts(InteractionContextType.Guild)
  .addStringOption((opt) =>
    opt
      .setName('icao')
      .setDescription('ICAO airport code, e.g. KDEN')
      .setRequired(true)
      .setMinLength(4)
      .setMaxLength(4),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  ctx: CertaContext,
): Promise<void> {
  requireGuild(interaction, ctx);
  const icao = interaction.options.getString('icao', true).trim().toUpperCase();
  if (!ICAO_PATTERN.test(icao)) {
    throw new UserFacingError(
      'Enter a 4-character ICAO code, e.g. `KDEN` (US airports start with K).',
    );
  }
  await interaction.deferReply();
  const report = await ctx.preflight.report(icao);
  if (report.metar.ok && !report.metar.value && report.taf.ok && !report.taf.value) {
    // The reply is already public (deferred), so answer in place rather than throwing.
    await interaction.editReply(
      `No METAR or TAF found for **${icao}**. Check the identifier; only weather-reporting airports work.`,
    );
    return;
  }
  await interaction.editReply({ embeds: [buildPreflightEmbed(report)] });
}
