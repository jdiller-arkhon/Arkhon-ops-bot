import { ConfigError, createLogger, loadCommands, loadDotEnv } from '@arkhon/shared';
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { COMMANDS_DIR } from './commands-dir.js';
import { loadOpsConfig } from './config.js';
import type { OpsContext } from './context.js';
import { openDatabase } from './db.js';
import { onFeedbackReaction, onFeedbackThreadCreate } from './feedback/forum.js';
import { createInteractionHandler } from './interactions.js';
import { onBotJoin } from './onboarding/bot-role.js';
import { sendWelcomeDm } from './onboarding/welcome.js';
import { startPresenceRotation } from './presence.js';
import { createWebhookServer } from './releases/server.js';
import { onTicketMessage } from './tickets/service.js';
import { notifyPendingBlueprint } from './setup/notice.js';
import { runLayoutTasks } from './startup.js';
import { LayoutStore } from './layout.js';
import { CommunityApi } from './verification/api.js';
import { reconcileMemberLinks } from './verification/reconcile.js';
import { guardProductRoles, onMemberJoinShield } from './verification/service.js';
import { AttemptLimiter, RaidShield } from './verification/shield.js';

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadOpsConfig();
  const logger = createLogger('ops', { level: config.logLevel });
  const prisma = await openDatabase(config.database, logger);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers, // welcome DMs, staff role membership
      GatewayIntentBits.GuildMessages, // ticket reply tracking
      GatewayIntentBits.MessageContent, // ticket transcripts and feedback issue bodies
      GatewayIntentBits.GuildMessageReactions, // feedback promotion
    ],
    // Reactions on messages sent before the bot started arrive as partials.
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.Reaction,
      Partials.User,
      Partials.GuildMember,
    ],
    allowedMentions: { parse: [] },
  });

  const layout = new LayoutStore(config.layoutOverrides);
  const ctx: OpsContext = {
    config,
    logger,
    prisma,
    client,
    layout,
    security: {
      api: CommunityApi.fromConfig(config),
      attempts: new AttemptLimiter(config.verification.maxAttemptsPerHour, 3_600_000),
      raid: new RaidShield(
        config.raid.joinThreshold,
        config.raid.windowSeconds * 1000,
        config.raid.lockdownMinutes * 60_000,
      ),
    },
  };
  if (!ctx.security.api) {
    logger.warn(
      'member verification is off: set ARKHON_COMMUNITY_API_TOKEN and MEMBER_WEBHOOK_SECRET',
    );
  }
  const commands = await loadCommands<OpsContext>(COMMANDS_DIR);
  logger.info({ commands: [...commands.keys()] }, 'commands loaded');

  client.once(Events.ClientReady, async (ready) => {
    logger.info({ user: ready.user.tag }, 'connected to Discord');
    const guild = await ready.guilds.fetch(config.discord.guildId).catch(() => null);
    if (!guild) {
      logger.fatal(
        { guildId: config.discord.guildId },
        'bot is not in the configured guild; invite it first',
      );
      return;
    }
    startPresenceRotation(ready, ctx, guild);
    try {
      await guild.members.fetch();
    } catch (error) {
      logger.error({ err: error }, 'could not cache guild members');
    }
    if (ctx.layout.current) {
      await runLayoutTasks(ctx, guild);
      await notifyPendingBlueprint(ctx, guild).catch((error: unknown) =>
        logger.warn({ err: error }, 'could not check the blueprint for new resources'),
      );
      if (ctx.security.api) {
        // Website events are best-effort; this keeps Discord in line with the website.
        const every = config.verification.reconcileMinutes * 60_000;
        const run = () =>
          void reconcileMemberLinks(ctx, guild).catch((error: unknown) =>
            logger.error({ err: error }, 'member reconciliation failed'),
          );
        setTimeout(run, 60_000).unref();
        setInterval(run, every).unref();
      }
    } else {
      logger.warn(
        { missing: ctx.layout.missing },
        'server is not set up yet: an administrator should run /setup server',
      );
    }
    logger.info('startup complete');
  });

  client.on(Events.InteractionCreate, createInteractionHandler(ctx, commands));
  client.on(Events.GuildMemberAdd, (member) => {
    if (member.user.bot) {
      onBotJoin(ctx, member).catch((error: unknown) =>
        logger.error(
          { err: error, userId: member.id },
          'could not give a bot the Arkhon Systems role',
        ),
      );
      return;
    }
    void sendWelcomeDm(member, ctx);
    onMemberJoinShield(ctx, member).catch((error: unknown) =>
      logger.error({ err: error }, 'raid shield failed'),
    );
  });
  client.on(Events.GuildMemberUpdate, (before, after) => {
    guardProductRoles(ctx, before, after).catch((error: unknown) =>
      logger.error({ err: error, userId: after.id }, 'product role guard failed'),
    );
  });
  client.on(Events.MessageCreate, (message) => {
    onTicketMessage(message, ctx).catch((error: unknown) =>
      logger.error({ err: error, channelId: message.channelId }, 'ticket message tracking failed'),
    );
  });
  client.on(Events.ThreadCreate, (thread, newlyCreated) => {
    onFeedbackThreadCreate(thread, newlyCreated, ctx).catch((error: unknown) =>
      logger.error({ err: error, threadId: thread.id }, 'feedback thread check failed'),
    );
  });
  client.on(Events.MessageReactionAdd, (reaction, user) => {
    onFeedbackReaction(reaction, user, ctx).catch((error: unknown) =>
      logger.error({ err: error, messageId: reaction.message.id }, 'feedback reaction failed'),
    );
  });
  client.on(Events.Error, (error) => logger.error({ err: error }, 'discord client error'));
  client.on(Events.Warn, (message) => logger.warn({ message }, 'discord client warning'));

  const server = createWebhookServer(ctx);
  server.listen(config.webhooks.port, () =>
    logger.info({ port: config.webhooks.port }, 'webhook server listening'),
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    server.close();
    await client.destroy();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await prisma.$connect();
  await layout.load(prisma);
  logger.info({ ready: Boolean(layout.current), missing: layout.missing }, 'server layout loaded');
  await client.login(config.discord.token);
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
  } else {
    console.error('Fatal error during startup:', error);
  }
  process.exit(1);
});
