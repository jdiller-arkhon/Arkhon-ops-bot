import { arkhonEmbed, productLabel, type Product } from '@arkhon/shared';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type BaseMessageOptions,
} from 'discord.js';
import { ids, TICKET_FIELDS } from '../ids.js';

export function buildSupportPanel(): BaseMessageOptions {
  const embed = arkhonEmbed({
    title: 'Need help?',
    description: [
      'Open a private support ticket and the right team will pick it up.',
      '',
      '**Certa Support** — flight operations, logbook, compliance exports.',
      '**Argus Support** — anything Argus.',
      '',
      'Only you and the matching staff team can see your ticket.',
    ].join('\n'),
  });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ids.ticketOpen('certa'))
      .setLabel('Certa Support')
      .setEmoji('🛩️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(ids.ticketOpen('argus'))
      .setLabel('Argus Support')
      .setEmoji('👁️')
      .setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [row] };
}

export function buildTicketModal(product: Product): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(ids.ticketModal(product))
    .setTitle(`${productLabel(product)} support ticket`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(TICKET_FIELDS.subject)
          .setLabel('Subject')
          .setStyle(TextInputStyle.Short)
          .setMinLength(3)
          .setMaxLength(100)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(TICKET_FIELDS.description)
          .setLabel('What is going on?')
          .setPlaceholder('Steps to reproduce, what you expected, what happened instead.')
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(10)
          .setMaxLength(2000)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(TICKET_FIELDS.appVersion)
          .setLabel('App version (optional)')
          .setPlaceholder('e.g. 2.4.1')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(32)
          .setRequired(false),
      ),
    );
}

export function buildStaffControls(ticketId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ids.ticketClaim(ticketId))
      .setLabel('Claim')
      .setEmoji('🙋')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(ids.ticketWaiting(ticketId))
      .setLabel('Mark Waiting on User')
      .setEmoji('⏳')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(ids.ticketClose(ticketId))
      .setLabel('Close')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger),
  );
}
