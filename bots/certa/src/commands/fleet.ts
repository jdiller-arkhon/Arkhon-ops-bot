import { arkhonEmbed } from '@arkhon/shared';
import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { callCerta, requireGuild, requireLink } from '../access.js';
import type { CertaContext } from '../context.js';
import { aircraftCheck, batteriesFor, batteryCheck, type Level } from '../domain/fleet.js';
import { formatHours } from '../domain/flight.js';

export const DOT: Record<Level, string> = { green: '🟢', amber: '🟡', red: '🔴' };

export const data = new SlashCommandBuilder()
  .setName('fleet')
  .setDescription('Your aircraft and batteries in Certa: airworthiness, registration and cycles')
  .setDefaultMemberPermissions(PermissionFlagsBits.UseApplicationCommands)
  .setContexts(InteractionContextType.Guild);

export async function execute(
  interaction: ChatInputCommandInteraction,
  ctx: CertaContext,
): Promise<void> {
  requireGuild(interaction, ctx);
  const link = await requireLink(ctx, interaction.user.id);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const fleet = await callCerta(ctx, 'getFleet', () => ctx.certa.getFleet(link.certaUserId));
  const today = ctx.now().toISODate()!;
  const active = fleet.aircraft.filter((a) => a.status !== 'retired');
  if (active.length === 0) {
    await interaction.editReply('No aircraft in your Certa fleet yet. Add one in Certa → Fleet.');
    return;
  }
  const fields = active.slice(0, 10).map((a) => {
    const check = aircraftCheck(a, today);
    const packs = batteriesFor(a, fleet.batteries)
      .filter((b) => b.status !== 'retired')
      .map((b) => {
        const c = batteryCheck(b);
        return `${DOT[c.level]} ${b.label} · ${c.detail}`;
      });
    return {
      name: `${DOT[check.level]} ${a.name} · ${a.makeModel}`,
      value: [
        check.detail,
        `${a.totalFlights} flights · ${formatHours(a.totalMinutes)}`,
        ...(packs.length ? ['**Batteries**', ...packs] : []),
      ].join('\n'),
    };
  });
  await interaction.editReply({
    embeds: [
      arkhonEmbed({
        title: `Fleet: ${link.displayName}`,
        description: 'Run `/gonogo` before a flight for a full go/no-go check.',
        product: 'certa',
        fields,
      }),
    ],
  });
}
