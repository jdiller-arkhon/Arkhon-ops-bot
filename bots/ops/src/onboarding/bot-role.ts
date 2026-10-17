import type { Guild, GuildMember } from 'discord.js';
import type { OpsContext } from '../context.js';

interface MemberLike {
  user: { bot: boolean };
  roles: { cache: { has(id: string): boolean } };
}

/** Bot accounts that do not have the Arkhon Systems role yet. */
export function botsMissingRole<T extends MemberLike>(members: Iterable<T>, roleId: string): T[] {
  return [...members].filter((member) => member.user.bot && !member.roles.cache.has(roleId));
}

/** Gives the Arkhon Systems role to every bot in the server that lacks it. Returns how many. */
export async function assignBotRole(guild: Guild, roleId: string, reason: string): Promise<number> {
  const members = await guild.members.fetch();
  const missing = botsMissingRole(members.values(), roleId);
  for (const member of missing) await member.roles.add(roleId, reason);
  return missing.length;
}

/** A bot joined: give it the Arkhon Systems role (once the server is set up). */
export async function onBotJoin(ctx: OpsContext, member: GuildMember): Promise<void> {
  const roleId = ctx.layout.current?.roles.bots;
  if (!roleId || member.roles.cache.has(roleId)) return;
  await member.roles.add(roleId, 'Arkhon Systems role for bots');
  ctx.logger.info(
    { userId: member.id, tag: member.user.tag },
    'bot joined: Arkhon Systems role added',
  );
}
