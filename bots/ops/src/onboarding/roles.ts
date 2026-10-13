import { arkhonEmbed, productLabel, UserFacingError, type Product } from '@arkhon/shared';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type BaseMessageOptions,
  type ButtonInteraction,
} from 'discord.js';
import type { OpsContext } from '../context.js';
import { ids } from '../ids.js';
import { requireGuildMember } from '../permissions.js';

export type RoleChoice = Product | 'both';

export function isRoleChoice(value: string | undefined): value is RoleChoice {
  return value === 'certa' || value === 'argus' || value === 'both';
}

export function buildRolePanel(): BaseMessageOptions {
  const embed = arkhonEmbed({
    title: 'Pick your products',
    description: [
      'Choose which product channels you want to see. You can change this at any time.',
      '',
      '**Certa User** — drone flight operations and compliance logbook.',
      '**Argus User** — the Argus product channels.',
      '**Both** — everything.',
      '',
      'Clicking **Certa User** or **Argus User** again removes that role.',
    ].join('\n'),
  });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ids.role('certa'))
      .setLabel('Certa User')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(ids.role('argus'))
      .setLabel('Argus User')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(ids.role('both'))
      .setLabel('Both')
      .setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row] };
}

/**
 * Certa/Argus toggle that product's user role; Both adds both roles.
 */
export async function handleRoleButton(
  interaction: ButtonInteraction,
  choice: RoleChoice,
  ctx: OpsContext,
): Promise<void> {
  const member = requireGuildMember(interaction, ctx.config);
  const layout = ctx.layout.require();
  const roles = layout.roles.user;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const me = member.guild.members.me;
  for (const roleId of Object.values(roles)) {
    const role = member.guild.roles.cache.get(roleId);
    if (!role) throw new Error(`Configured user role ${roleId} does not exist`);
    if (!me || me.roles.highest.comparePositionTo(role) <= 0) {
      throw new UserFacingError('I cannot manage product roles yet. Please let a moderator know.');
    }
  }

  const reason = 'Role panel in #start-here';
  let message: string;
  if (choice === 'both') {
    await member.roles.add([roles.certa, roles.argus], reason);
    message =
      'You now have **Certa User** and **Argus User**. Both product categories are unlocked.';
  } else {
    const roleId = roles[choice];
    const label = productLabel(choice);
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId, reason);
      message = `Removed **${label} User**. The ${label} channels are hidden again.`;
    } else {
      await member.roles.add(roleId, reason);
      message = `You now have **${label} User**. Check out <#${layout.channels.home[choice]}>.`;
    }
  }
  ctx.logger.info({ userId: member.id, choice }, 'role panel used');
  await interaction.editReply(message);
}
