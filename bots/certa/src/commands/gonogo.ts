import { arkhonEmbed, UserFacingError } from '@arkhon/shared';
import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { callCerta, requireGuild, requireLink } from '../access.js';
import type { CertaContext } from '../context.js';
import { summarizeCurrency } from '../domain/currency.js';
import { lightPeriod, sunTimes } from '../domain/daylight.js';
import {
  aircraftCheck,
  batteriesFor,
  batteryCheck,
  decide,
  lightCheck,
  pickAircraft,
  pilotCheck,
  type Check,
} from '../domain/fleet.js';
import { ADVISORY_NOTICE } from '../preflight/embed.js';
import { DOT } from './fleet.js';

const ICAO_PATTERN = /^[A-Z][A-Z0-9]{3}$/;
const HEADLINE = {
  GO: '🟢 **GO**: records and conditions check out',
  CAUTION: '🟡 **CAUTION**: review the amber items before you launch',
  'NO-GO': '🔴 **NO-GO**: fix the red items before you fly',
} as const;

export const data = new SlashCommandBuilder()
  .setName('gonogo')
  .setDescription('Go/no-go check: your currency, aircraft, batteries, and optionally the weather')
  .setDefaultMemberPermissions(PermissionFlagsBits.UseApplicationCommands)
  .setContexts(InteractionContextType.Guild)
  .addStringOption((opt) =>
    opt
      .setName('aircraft')
      .setDescription('Which aircraft (optional if you only have one)')
      .setAutocomplete(true),
  )
  .addStringOption((opt) =>
    opt
      .setName('icao')
      .setDescription('Add live weather and daylight for this airport, e.g. KDEN')
      .setMinLength(4)
      .setMaxLength(4),
  );

export async function autocomplete(
  interaction: AutocompleteInteraction,
  ctx: CertaContext,
): Promise<void> {
  const link = await ctx.store.getLink(interaction.user.id);
  if (!link) return interaction.respond([]);
  const fleet = await ctx.certa.getFleet(link.certaUserId).catch(() => null);
  const q = interaction.options.getFocused().toLowerCase();
  const choices = (fleet?.aircraft ?? [])
    .filter((a) => a.status !== 'retired')
    .filter((a) => !q || `${a.name} ${a.makeModel}`.toLowerCase().includes(q))
    .slice(0, 25)
    .map((a) => ({ name: `${a.name} · ${a.makeModel}`.slice(0, 100), value: a.id }));
  await interaction.respond(choices);
}

export async function execute(
  interaction: ChatInputCommandInteraction,
  ctx: CertaContext,
): Promise<void> {
  requireGuild(interaction, ctx);
  const link = await requireLink(ctx, interaction.user.id);
  const icao = interaction.options.getString('icao')?.trim().toUpperCase() ?? null;
  if (icao && !ICAO_PATTERN.test(icao)) {
    throw new UserFacingError('Enter a 4-character ICAO code, e.g. `KDEN`.');
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const [fleet, currency, report] = await Promise.all([
    callCerta(ctx, 'getFleet', () => ctx.certa.getFleet(link.certaUserId)),
    callCerta(ctx, 'getCurrency', () => ctx.certa.getCurrency(link.certaUserId)),
    icao ? ctx.preflight.report(icao) : Promise.resolve(null),
  ]);
  const aircraft = pickAircraft(fleet.aircraft, interaction.options.getString('aircraft'));
  if (!aircraft) {
    const names = fleet.aircraft.filter((a) => a.status !== 'retired').map((a) => `\`${a.name}\``);
    throw new UserFacingError(
      names.length
        ? `Pick an aircraft with the \`aircraft\` option: ${names.join(', ')}.`
        : 'No aircraft in your Certa fleet yet. Add one in Certa → Fleet.',
    );
  }

  const now = ctx.now();
  const today = now.toISODate()!;
  const checks: Check[] = [
    pilotCheck(link.displayName, summarizeCurrency(currency, today)),
    aircraftCheck(aircraft, today),
    ...batteriesFor(aircraft, fleet.batteries)
      .filter((b) => b.status !== 'retired')
      .map(batteryCheck),
  ];
  if (report) {
    const wx = report.assessment;
    checks.push({
      label: `Weather · ${report.icao}`,
      level: wx.level === 'GO' ? 'green' : 'amber',
      detail: wx.level === 'GO' ? 'Within configured limits' : wx.reasons.join('; '),
    });
    const metar = report.metar.ok ? report.metar.value : null;
    if (metar) {
      const t = sunTimes(now.set({ hour: 12, minute: 0 }).toJSDate(), metar.lat, metar.lon);
      checks.push(lightCheck(lightPeriod(now.toJSDate(), t)));
    }
    if (report.tfrs.ok && report.tfrs.value.length) {
      checks.push({
        label: 'TFRs',
        level: 'amber',
        detail: `${report.tfrs.value.length} within ${report.tfrRadiusNm} NM: check before launch`,
      });
    }
  }

  const decision = decide(checks);
  await interaction.editReply({
    embeds: [
      arkhonEmbed({
        title: `Go/no-go: ${aircraft.name} (${aircraft.makeModel})`,
        description:
          `${HEADLINE[decision]}\n\n` +
          checks.map((c) => `${DOT[c.level]} **${c.label}**: ${c.detail}`).join('\n') +
          (report ? '' : '\n\n-# Add `icao:` to include live weather, daylight and TFRs.'),
        product: 'certa',
      }).setFooter({ text: `Advisory: the remote pilot in command decides. ${ADVISORY_NOTICE}` }),
    ],
  });
}
