import { arkhonEmbed, UserFacingError } from '@arkhon/shared';
import {
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  time,
  TimestampStyles,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { requireGuild } from '../access.js';
import type { CertaContext } from '../context.js';
import { lightPeriod, sunTimes } from '../domain/daylight.js';
import { FALLBACK_STATUS_AIRPORT } from '../presence.js';
import { ADVISORY_NOTICE } from '../preflight/embed.js';

const ICAO_PATTERN = /^[A-Z][A-Z0-9]{3}$/;

export const data = new SlashCommandBuilder()
  .setName('daylight')
  .setDescription('Sunrise, sunset and civil twilight at an airport (Part 107 night rules)')
  .setDefaultMemberPermissions(PermissionFlagsBits.UseApplicationCommands)
  .setContexts(InteractionContextType.Guild)
  .addStringOption((opt) =>
    opt
      .setName('icao')
      .setDescription('ICAO airport code, e.g. KDEN (defaults to the home airport)')
      .setMinLength(4)
      .setMaxLength(4),
  );

const at = (d: Date | null) => (d ? `${time(d, TimestampStyles.ShortTime)}` : 'n/a');

export async function execute(
  interaction: ChatInputCommandInteraction,
  ctx: CertaContext,
): Promise<void> {
  requireGuild(interaction, ctx);
  const icao = (
    interaction.options.getString('icao') ??
    ctx.config.preflightAirports[0] ??
    FALLBACK_STATUS_AIRPORT
  )
    .trim()
    .toUpperCase();
  if (!ICAO_PATTERN.test(icao)) {
    throw new UserFacingError('Enter a 4-character ICAO code, e.g. `KDEN`.');
  }
  await interaction.deferReply();
  // The airport position comes from its METAR station record (cached with /preflight).
  const report = await ctx.preflight.report(icao);
  const metar = report.metar.ok ? report.metar.value : null;
  if (!metar) {
    await interaction.editReply(
      `Couldn't find a position for **${icao}**. Only weather-reporting airports work.`,
    );
    return;
  }
  const now = ctx.now();
  const t = sunTimes(now.set({ hour: 12, minute: 0 }).toJSDate(), metar.lat, metar.lon);
  const period = lightPeriod(now.toJSDate(), t);
  const status =
    period === 'day'
      ? '☀️ **Daylight**: standard Part 107 operations'
      : period === 'civil-twilight'
        ? '🌆 **Civil twilight**: anti-collision lighting visible for 3 SM required'
        : '🌙 **Night**: anti-collision lighting and night-qualified training required';
  const fields = t.polar
    ? [{ name: 'Sun', value: t.polar === 'day' ? 'Up all day' : 'Down all day' }]
    : [
        { name: '🌅 Civil dawn', value: at(t.civilDawn), inline: true },
        { name: '☀️ Sunrise', value: at(t.sunrise), inline: true },
        { name: '​', value: '​', inline: true },
        { name: '🌇 Sunset', value: at(t.sunset), inline: true },
        { name: '🌆 Civil dusk', value: at(t.civilDusk), inline: true },
        { name: '​', value: '​', inline: true },
      ];
  await interaction.editReply({
    embeds: [
      arkhonEmbed({
        title: `Daylight: ${icao}${metar.name ? ` (${metar.name})` : ''}`,
        description:
          `${status}\n\n-# Times show in your own time zone. Civil twilight is when the sun is ` +
          'up to 6° below the horizon (14 CFR 107.29).',
        product: 'certa',
        fields,
      }).setFooter({ text: ADVISORY_NOTICE }),
    ],
  });
}
