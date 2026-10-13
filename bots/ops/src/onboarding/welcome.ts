import { arkhonEmbed } from '@arkhon/shared';
import type { GuildMember } from 'discord.js';
import type { OpsContext } from '../context.js';
import type { ServerLayout } from '../layout.js';

function channelLink(guildId: string, channelId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

export function buildWelcomeEmbed(member: GuildMember, layout: ServerLayout) {
  const guildId = member.guild.id;
  const channels = layout.channels;
  return arkhonEmbed({
    title: `Welcome to ${member.guild.name}`,
    description: [
      `Hi ${member.user.username}, thanks for joining the Arkhon Industries pilot community: support, release notes and discussion for **Certa** (drone flight operations and compliance logbook) and **Argus**.`,
      '',
      `**First, verify your membership** in [#verify](${channelLink(guildId, channels.verify)}). It takes a minute:`,
      '1. Copy your member ID from arkhonindustries.com → Settings.',
      '2. Click **Verify membership** in #verify and paste it.',
      '3. Approve the request on arkhonindustries.com.',
      '',
      `Once verified, the rest of the server unlocks: pick your products in [#start-here](${channelLink(guildId, channels.startHere)}) and open private tickets in [#support](${channelLink(guildId, channels.support)}).`,
    ].join('\n'),
  });
}

export async function sendWelcomeDm(member: GuildMember, ctx: OpsContext): Promise<void> {
  const layout = ctx.layout.current;
  if (!layout || member.user.bot || member.guild.id !== ctx.config.discord.guildId) return;
  try {
    await member.send({ embeds: [buildWelcomeEmbed(member, layout)] });
    ctx.logger.info({ userId: member.id }, 'welcome DM sent');
  } catch (error) {
    // Users with DMs disabled are common; this is not an error.
    ctx.logger.info({ userId: member.id, err: error }, 'welcome DM not delivered');
  }
}
