import { arkhonEmbed } from '@arkhon/shared';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type BaseMessageOptions,
} from 'discord.js';
import { ids, VERIFY_FIELDS } from '../ids.js';

export function memberSettingsUrl(websiteUrl: string): string {
  return `${websiteUrl}/app/settings#member-id`;
}

export function buildVerifyPanel(websiteUrl: string): BaseMessageOptions {
  const embed = arkhonEmbed({
    title: 'Verify your Arkhon membership',
    description: [
      'This server is for Arkhon Industries members. Link your account to unlock it.',
      '',
      '**1.** Find your member ID on arkhonindustries.com → Settings. It looks like `ARK-K7Q4M-2XR9F`.',
      '**2.** Click **Verify membership** and enter it.',
      '**3.** Approve the request on arkhonindustries.com while signed in.',
      '',
      'Your member ID is only shared with the Arkhon team. Each member ID can be linked to one Discord account.',
    ].join('\n'),
  });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ids.verifyStart)
      .setLabel('Verify membership')
      .setEmoji('🔐')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setURL(memberSettingsUrl(websiteUrl))
      .setLabel('Find my member ID')
      .setStyle(ButtonStyle.Link),
  );
  return { embeds: [embed], components: [row] };
}

export function buildVerifyModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(ids.verifySubmit)
    .setTitle('Verify your Arkhon membership')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(VERIFY_FIELDS.memberId)
          .setLabel('Member ID')
          .setPlaceholder('ARK-XXXXX-XXXXX')
          .setStyle(TextInputStyle.Short)
          .setMinLength(10)
          .setMaxLength(20)
          .setRequired(true),
      ),
    );
}

export function buildConfirmRow(
  confirmUrl: string,
  requestId: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setURL(confirmUrl)
      .setLabel('Approve on arkhonindustries.com')
      .setStyle(ButtonStyle.Link),
    new ButtonBuilder()
      .setCustomId(ids.verifyCheck(requestId))
      .setLabel("I've approved")
      .setStyle(ButtonStyle.Secondary),
  );
}
