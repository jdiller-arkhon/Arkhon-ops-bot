import { arkhonEmbed, truncate } from '@arkhon/shared';
import type { Guild } from 'discord.js';
import type { OpsContext } from '../context.js';
import { pendingCreates, type PlanItem } from './plan.js';
import { planForGuild } from './session.js';

/** The #mod-log text for blueprint resources the server does not have yet. */
export function pendingBlueprintMessage(pending: PlanItem[]): string {
  const names = truncate(pending.map((item) => item.name).join(', '), 1500);
  return [
    `This version of the bot adds **${pending.length}** item${pending.length === 1 ? '' : 's'} the server does not have yet:`,
    names,
    '',
    'An admin can run `/setup server` to preview and apply them. Nothing changes until then, and existing channels and roles are never duplicated.',
  ].join('\n');
}

/**
 * On startup (usually right after a deploy), tells staff in #mod-log when the blueprint has
 * resources this server is missing, so new features are not left half set up.
 */
export async function notifyPendingBlueprint(ctx: OpsContext, guild: Guild): Promise<void> {
  const layout = ctx.layout.current;
  if (!layout) return;
  const pending = pendingCreates(await planForGuild(ctx, guild));
  if (pending.length === 0) return;
  ctx.logger.info(
    { pending: pending.map((item) => item.key) },
    'blueprint has resources this server does not',
  );
  const modLog = await guild.channels.fetch(layout.channels.modLog).catch(() => null);
  if (!modLog?.isSendable()) return;
  await modLog.send({
    embeds: [
      arkhonEmbed({
        title: '🆕 Server update available',
        description: pendingBlueprintMessage(pending),
      }),
    ],
    allowedMentions: { parse: [] },
  });
}
