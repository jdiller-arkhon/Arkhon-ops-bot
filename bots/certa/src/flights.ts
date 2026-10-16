import { UserFacingError } from '@arkhon/shared';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { callCerta, requireGuild, requireLink } from './access.js';
import { missionTypeSchema } from './certa/types.js';
import { resolveChannels } from './channels.js';
import type { CertaContext } from './context.js';
import { publicLocation, validateFlightForm } from './domain/flight.js';
import { flightEmbed } from './embeds.js';
import { fitsCustomId, ids, LOG_FIELDS } from './ids.js';

/** The /log modal: validates, logs to Certa, and offers to share a public summary. */
export async function handleLogModal(
  interaction: ModalSubmitInteraction,
  missionArg: string | undefined,
  ctx: CertaContext,
): Promise<void> {
  requireGuild(interaction, ctx);
  const link = await requireLink(ctx, interaction.user.id);
  const mission = missionTypeSchema.safeParse(missionArg);
  if (!mission.success) throw new UserFacingError('That form has expired. Run `/log` again.');

  const field = (id: string) => interaction.fields.getTextInputValue(id) ?? '';
  const validation = validateFlightForm(
    {
      date: field(LOG_FIELDS.date),
      location: field(LOG_FIELDS.location),
      aircraft: field(LOG_FIELDS.aircraft),
      duration: field(LOG_FIELDS.duration),
      notes: field(LOG_FIELDS.notes),
      missionType: mission.data,
    },
    ctx.now(),
  );
  if (!validation.ok) {
    throw new UserFacingError(
      `Flight not logged. Fix the following and run \`/log\` again:\n${validation.errors.map((e) => `• ${e}`).join('\n')}`,
    );
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { flight } = validation;
  const { flightId } = await callCerta(ctx, 'logFlight', () =>
    ctx.certa.logFlight(link.certaUserId, flight),
  );
  ctx.logger.info({ userId: interaction.user.id, flightId }, 'flight logged');

  const embed = flightEmbed('✅ Flight logged to Certa', flight);
  if (flight.notes) embed.addFields({ name: 'Notes', value: flight.notes });

  // The flight is saved; skip the share button rather than fail if it cannot be offered.
  const channels = await resolveChannels(ctx.prisma, ctx.config.channelOverrides);
  const shareId = ids.logShare(flightId);
  if (!channels.flightLogs || !fitsCustomId(shareId)) {
    await interaction.editReply({ embeds: [embed] });
    return;
  }
  await ctx.store.saveSharedFlight({
    flightId,
    discordUserId: interaction.user.id,
    date: flight.date,
    publicLocation: publicLocation(flight.location, flight.locationIsIcao),
    aircraft: flight.aircraft,
    durationMinutes: flight.durationMinutes,
    missionType: flight.missionType,
  });
  const button = new ButtonBuilder()
    .setCustomId(shareId)
    .setLabel('Share to #flight-logs')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('📣');
  await interaction.editReply({
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
  });
}

/**
 * Posts the public summary: date, duration, mission, aircraft and a coarsened location (ICAO
 * code, or city; never coordinates or street addresses). Notes are never shared.
 */
export async function handleShareButton(
  interaction: ButtonInteraction,
  flightId: string | undefined,
  ctx: CertaContext,
): Promise<void> {
  requireGuild(interaction, ctx);
  const flight = flightId ? await ctx.store.getSharedFlight(flightId) : null;
  if (!flightId || !flight || flight.discordUserId !== interaction.user.id) {
    throw new UserFacingError('This flight can no longer be shared.');
  }
  const { flightLogs } = await resolveChannels(ctx.prisma, ctx.config.channelOverrides);
  const channel = flightLogs ? await ctx.client.channels.fetch(flightLogs).catch(() => null) : null;
  if (!channel || !channel.isSendable()) {
    ctx.logger.warn({ channelId: flightLogs }, 'flight logs channel missing or not sendable');
    throw new UserFacingError(
      'The #flight-logs channel is not available right now. Ask an admin to run `/setup server`.',
    );
  }
  if (!(await ctx.store.markShared(flightId))) {
    throw new UserFacingError('This flight has already been shared.');
  }
  try {
    await channel.send({
      embeds: [
        flightEmbed(`🛩️ ${interaction.user.displayName} logged a flight`, {
          ...flight,
          location: flight.publicLocation,
        }),
      ],
    });
  } catch (error) {
    await ctx.store.unmarkShared(flightId);
    throw error;
  }
  const done = new ButtonBuilder()
    .setCustomId(ids.logShare(flightId))
    .setLabel('Shared to #flight-logs')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('✅')
    .setDisabled(true);
  await interaction.update({
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(done)],
  });
}
