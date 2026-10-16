import { UserFacingError } from '@arkhon/shared';
import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { callCerta, requireGuild } from '../access.js';
import type { CertaContext } from '../context.js';
import { REMINDER_THRESHOLDS } from '../domain/reminders.js';

/** One-time codes from the Certa app: 6-32 characters of A-Z, 0-9 and dashes. */
export const LINK_CODE_PATTERN = /^[A-Z0-9-]{6,32}$/;

export function normalizeLinkCode(input: string): string | undefined {
  const code = input.trim().toUpperCase().replace(/\s+/g, '');
  return LINK_CODE_PATTERN.test(code) ? code : undefined;
}

export const data = new SlashCommandBuilder()
  .setName('certa')
  .setDescription('Link your Discord account to Certa and manage reminders')
  .setDefaultMemberPermissions(PermissionFlagsBits.UseApplicationCommands)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('link')
      .setDescription('Link your account using a one-time code from the Certa app')
      .addStringOption((opt) =>
        opt
          .setName('code')
          .setDescription('Code from Certa → Settings → Discord')
          .setRequired(true)
          .setMaxLength(40),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('unlink').setDescription('Remove the link between your Discord and Certa accounts'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('reminders')
      .setDescription('Turn recurrent training reminder DMs on or off')
      .addStringOption((opt) =>
        opt
          .setName('state')
          .setDescription('on or off')
          .setRequired(true)
          .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }),
      ),
  );

async function link(interaction: ChatInputCommandInteraction, ctx: CertaContext): Promise<void> {
  const code = normalizeLinkCode(interaction.options.getString('code', true));
  if (!code) {
    throw new UserFacingError(
      'That does not look like a Certa link code. Copy it exactly as shown in the Certa app.',
    );
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await callCerta(ctx, 'redeemLinkCode', () =>
    ctx.certa.redeemLinkCode(code, interaction.user.id),
  );
  await ctx.store.upsertLink(interaction.user.id, result.certaUserId, result.displayName);
  ctx.logger.info(
    { userId: interaction.user.id, certaUserId: result.certaUserId },
    'Certa account linked',
  );
  await interaction.editReply(
    `Linked to Certa as **${result.displayName}**. Try \`/log\`, \`/hours\` or \`/currency\`. ` +
      'Recurrent training reminders are on; turn them off with `/certa reminders state:off`.',
  );
}

async function unlink(interaction: ChatInputCommandInteraction, ctx: CertaContext): Promise<void> {
  const removed = await ctx.store.deleteLink(interaction.user.id);
  if (removed) ctx.logger.info({ userId: interaction.user.id }, 'Certa account unlinked');
  await interaction.reply({
    content: removed
      ? 'Your Discord account is no longer linked to Certa. Your Certa logbook is unchanged.'
      : "Your Discord account isn't linked to Certa, so there was nothing to remove.",
    flags: MessageFlags.Ephemeral,
  });
}

async function reminders(
  interaction: ChatInputCommandInteraction,
  ctx: CertaContext,
): Promise<void> {
  const enabled = interaction.options.getString('state', true) === 'on';
  if (!(await ctx.store.setRemindersEnabled(interaction.user.id, enabled))) {
    throw new UserFacingError(
      "Your Discord account isn't linked to Certa yet. Link it first with `/certa link`.",
    );
  }
  const days = REMINDER_THRESHOLDS.join(', ').replace(/, (\d+)$/, ' and $1');
  await interaction.reply({
    content: enabled
      ? `Recurrent training reminders are **on**. You will get DMs ${days} days before your due date.`
      : 'Recurrent training reminders are **off**. Check anytime with `/currency`.',
    flags: MessageFlags.Ephemeral,
  });
}

export async function execute(
  interaction: ChatInputCommandInteraction,
  ctx: CertaContext,
): Promise<void> {
  requireGuild(interaction, ctx);
  const sub = interaction.options.getSubcommand(true);
  if (sub === 'link') return link(interaction, ctx);
  if (sub === 'unlink') return unlink(interaction, ctx);
  return reminders(interaction, ctx);
}
