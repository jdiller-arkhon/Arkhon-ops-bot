import type { Guild } from 'discord.js';
import type { OpsContext } from './context.js';
import { ensureAutoModRules } from './moderation/automod.js';
import { buildRolePanel } from './onboarding/roles.js';
import { ensurePanel } from './panels/ensure.js';
import { buildRulesMessage, buildWelcomeMessage } from './setup/content.js';
import { buildSupportPanel } from './tickets/panel.js';
import { loadActiveTicketChannels } from './tickets/service.js';

/**
 * Brings the server in line with the current layout: panels, posted content and AutoMod rules.
 * Runs on startup and again after /setup server. Each step is independent; failures are logged
 * and returned so callers can report them.
 */
export async function runLayoutTasks(ctx: OpsContext, guild: Guild): Promise<string[]> {
  const { logger } = ctx;
  const failures: string[] = [];
  const layout = ctx.layout.current;
  if (!layout) {
    logger.warn({ missing: ctx.layout.missing }, 'server layout incomplete; run /setup server');
    return ['Server layout is incomplete'];
  }
  const ids = ctx.layout.ids;
  const steps: [string, () => Promise<unknown>][] = [
    ['load active tickets', () => loadActiveTicketChannels(ctx)],
    [
      'support panel',
      () => ensurePanel(ctx, 'support', layout.channels.support, buildSupportPanel()),
    ],
    ['role panel', () => ensurePanel(ctx, 'roles', layout.channels.startHere, buildRolePanel())],
    ['automod rules', () => ensureAutoModRules(guild, ctx.config, layout, logger)],
  ];
  if (layout.channels.welcome) {
    const channel = layout.channels.welcome;
    steps.push([
      'welcome message',
      () => ensurePanel(ctx, 'welcome', channel, buildWelcomeMessage(ids)),
    ]);
  }
  if (layout.channels.rules) {
    const channel = layout.channels.rules;
    steps.push(['rules message', () => ensurePanel(ctx, 'rules', channel, buildRulesMessage(ids))]);
  }
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (error) {
      failures.push(`${name}: ${(error as Error).message}`);
      logger.error({ err: error, step: name }, 'layout task failed');
    }
  }
  return failures;
}
