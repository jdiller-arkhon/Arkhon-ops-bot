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
      `Hi ${member.user.username}, thanks for joining the Arkhon Industries pilot community.`,
      '',
      'This server covers two products:',
      `• **Certa** — drone flight operations and compliance logbook. [Open the Certa channels](${channelLink(guildId, channels.home.certa)})`,
      `• **Argus** — [Open the Argus channels](${channelLink(guildId, channels.home.argus)})`,
      '',
      `Pick the products you use in [#start-here](${channelLink(guildId, channels.startHere)}) to unlock their channels.`,
      `Need help? Open a private ticket in [#support](${channelLink(guildId, channels.support)}).`,
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
