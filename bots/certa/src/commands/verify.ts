import { arkhonEmbed, UserFacingError } from '@arkhon/shared';
import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { callCerta, requireGuild } from '../access.js';
import type { VerifyQuery } from '../certa/types.js';
import type { CertaContext } from '../context.js';
import { DOT } from './fleet.js';

const KINDS = {
  registration: { label: 'FAA registration', max: 40, pattern: /^[A-Z0-9-]{3,40}$/ },
  serial: { label: 'aircraft serial number', max: 100, pattern: /^[A-Z0-9-]{3,100}$/ },
  certificate: { label: 'remote pilot certificate number', max: 40, pattern: /^[A-Z0-9-]{3,40}$/ },
} as const;
type Kind = keyof typeof KINDS;
const QUERY_KIND = {
  registration: 'registration',
  serial: 'serialNumber',
  certificate: 'certificateNumber',
} as const;

export const data = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Is this aircraft or pilot legal to fly, per Certa records? (private reply)')
  .setDefaultMemberPermissions(PermissionFlagsBits.UseApplicationCommands)
  .setContexts(InteractionContextType.Guild);
for (const kind of Object.keys(KINDS) as Kind[]) {
  data.addSubcommand((sub) =>
    sub
      .setName(kind)
      .setDescription(`Look up by ${KINDS[kind].label}`)
      .addStringOption((opt) =>
        opt
          .setName('value')
          .setDescription(KINDS[kind].label)
          .setRequired(true)
          .setMaxLength(KINDS[kind].max),
      ),
  );
}

/** Normalizes and validates the typed identifier. Exported for tests. */
export function parseVerifyQuery(kind: Kind, raw: string): VerifyQuery {
  const value = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (!KINDS[kind].pattern.test(value)) {
    throw new UserFacingError(`That doesn't look like a valid ${KINDS[kind].label}.`);
  }
  return { kind: QUERY_KIND[kind], value };
}

export async function execute(
  interaction: ChatInputCommandInteraction,
  ctx: CertaContext,
): Promise<void> {
  requireGuild(interaction, ctx);
  const kind = interaction.options.getSubcommand(true) as Kind;
  const query = parseVerifyQuery(kind, interaction.options.getString('value', true));
  // Ephemeral: lookups (especially certificate numbers) are never shown to the channel.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await callCerta(ctx, 'verify', () => ctx.certa.verify(query));
  if (!result) {
    await interaction.editReply(
      `No ${KINDS[kind].label} matching that value is on file in Certa. ` +
        'Lookups only cover pilots and aircraft registered with Certa.',
    );
    return;
  }
  const headline = result.legalToFly
    ? result.status === 'green'
      ? '🟢 **Legal to fly**: everything on file is current'
      : '🟡 **Legal to fly**, with items coming due'
    : '🔴 **Not legal to fly** per records on file';
  const reasons = result.reasons.length
    ? result.reasons
        .map((r) => `${DOT[r.level]} ${r.text}${r.dueOn ? ` (due ${r.dueOn})` : ''}`)
        .join('\n')
    : 'No issues on file.';
  await interaction.editReply({
    embeds: [
      arkhonEmbed({
        title: `Verify ${result.subject.type}: ${result.subject.name}`,
        description: `${headline}\n\n${reasons}`,
        product: 'certa',
        fields: [
          ...(result.subject.identifier
            ? [{ name: 'Registration', value: result.subject.identifier, inline: true }]
            : []),
          { name: 'As of', value: result.asOf, inline: true },
          { name: 'Rules', value: result.ruleSet, inline: true },
        ],
      }).setFooter({ text: result.notice }),
    ],
  });
}
