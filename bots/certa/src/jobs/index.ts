import type { Logger } from '@arkhon/shared';
import type { EmbedBuilder, Client } from 'discord.js';
import { DateTime } from 'luxon';
import type { CertaClient } from '../certa/client.js';
import { resolveChannels, type CertaChannel } from '../channels.js';
import type { CertaContext } from '../context.js';
import { summarizeCurrency } from '../domain/currency.js';
import { selectReminder } from '../domain/reminders.js';
import { currencyEmbed, leaderboardEmbed } from '../embeds.js';
import { buildPreflightEmbed } from '../preflight/embed.js';
import type { ReminderStore } from '../store.js';
import type { ScheduledJob } from './scheduler.js';

export type DmSender = (discordUserId: string, embed: EmbedBuilder) => Promise<boolean>;

export interface ReminderRunResult {
  checked: number;
  sent: number;
  failed: number;
}

/**
 * DMs every opted-in pilot who reached a new threshold (60/30/14/3 days). A reminder is recorded
 * only after the DM goes through, so a closed DM inbox is retried on the next daily run.
 */
export async function runRecurrentReminders(deps: {
  store: ReminderStore;
  certa: Pick<CertaClient, 'getCurrency'>;
  today: string;
  logger: Logger;
  send: DmSender;
}): Promise<ReminderRunResult> {
  const result: ReminderRunResult = { checked: 0, sent: 0, failed: 0 };
  for (const link of await deps.store.listRemindable()) {
    result.checked++;
    try {
      const summary = summarizeCurrency(await deps.certa.getCurrency(link.certaUserId), deps.today);
      if (!summary.dueDate || summary.daysRemaining === null) continue;
      const decision = selectReminder(
        summary.daysRemaining,
        await deps.store.sentReminderThresholds(link.discordUserId, summary.dueDate),
      );
      if (!decision) continue;

      const days = summary.daysRemaining;
      const embed = currencyEmbed(link.displayName, summary)
        .setTitle(
          days === 0
            ? '⏰ Part 107 recurrent training is due today'
            : `⏰ Part 107 recurrent training due in ${days} day${days === 1 ? '' : 's'}`,
        )
        .addFields({
          name: 'Reminder settings',
          value: 'Turn these DMs off with `/certa reminders state:off`.',
        });
      if (await deps.send(link.discordUserId, embed)) {
        await deps.store.recordRemindersSent(
          link.discordUserId,
          summary.dueDate,
          decision.markSent,
        );
        result.sent++;
      } else {
        result.failed++;
      }
    } catch (error) {
      result.failed++;
      deps.logger.warn({ err: error, userId: link.discordUserId }, 'reminder check failed');
    }
  }
  return result;
}

/** The YYYY-MM before `now`: the month the leaderboard posted on the 1st closes out. */
export function previousMonth(now: DateTime): string {
  return now.startOf('month').minus({ months: 1 }).toFormat('yyyy-LL');
}

async function sendDm(client: Client, userId: string, embed: EmbedBuilder, logger: Logger) {
  try {
    const user = await client.users.fetch(userId);
    await user.send({ embeds: [embed] });
    return true;
  } catch (error) {
    logger.info({ err: error, userId }, 'could not DM user (DMs closed?)');
    return false;
  }
}

/** Posts to one of the Certa channels; throws so the scheduler retries if it is unavailable. */
async function postTo(
  ctx: CertaContext,
  name: CertaChannel,
  content: string | undefined,
  embeds: EmbedBuilder[],
) {
  const channels = await resolveChannels(ctx.prisma, ctx.config.channelOverrides);
  const id = channels[name];
  if (!id) throw new Error(`Certa ${name} channel is not set up: run /setup server`);
  const channel = await ctx.client.channels.fetch(id);
  if (!channel || !channel.isSendable())
    throw new Error(`Certa ${name} channel ${id} is not sendable`);
  for (let i = 0; i < embeds.length; i += 10) {
    await channel.send({ content: i === 0 ? content : undefined, embeds: embeds.slice(i, i + 10) });
  }
}

export function createJobs(ctx: CertaContext): ScheduledJob[] {
  const { schedule, preflightAirports } = ctx.config;
  const jobs: ScheduledJob[] = [
    {
      name: 'recurrent-reminders',
      schedule: { kind: 'daily', time: schedule.reminders },
      run: async ({ now }) => {
        const result = await runRecurrentReminders({
          store: ctx.store,
          certa: ctx.certa,
          today: now.toISODate()!,
          logger: ctx.logger,
          send: (userId, embed) => sendDm(ctx.client, userId, embed, ctx.logger),
        });
        await ctx.store.pruneSharedFlights(30);
        ctx.logger.info(result, 'recurrent reminders sent');
      },
    },
    {
      name: 'monthly-leaderboard',
      schedule: { kind: 'monthly', day: 1, time: schedule.leaderboard },
      run: async ({ now }) => {
        const month = previousMonth(now);
        const entries = await ctx.certa.getLeaderboard('month', { month, limit: 10 });
        const label = DateTime.fromFormat(month, 'yyyy-LL').toFormat('LLLL yyyy');
        const embed = leaderboardEmbed(
          `🏆 Final leaderboard: ${label}`,
          entries,
          await ctx.store.discordIdsByCertaId(),
        );
        await postTo(ctx, 'home', undefined, [embed]);
      },
    },
  ];
  if (preflightAirports.length > 0) {
    jobs.push({
      name: 'daily-preflight',
      schedule: { kind: 'daily', time: schedule.preflight },
      run: async ({ now }) => {
        const reports = await Promise.all(
          preflightAirports.map((icao) => ctx.preflight.report(icao)),
        );
        await postTo(
          ctx,
          'preflight',
          `**Daily preflight for ${now.toFormat('cccc, LLL d')}**`,
          reports.map(buildPreflightEmbed),
        );
      },
    });
  } else {
    ctx.logger.info('daily preflight post is off: set CERTA_PREFLIGHT_AIRPORTS');
  }
  return jobs;
}
