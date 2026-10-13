import { ConfigError, createLogger, loadCommands, loadDotEnv } from '@arkhon/shared';
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { COMMANDS_DIR } from './commands-dir.js';
import { loadOpsConfig } from './config.js';
import type { OpsContext } from './context.js';
import { createPrisma } from './db.js';
import { onFeedbackReaction, onFeedbackThreadCreate } from './feedback/forum.js';
import { createInteractionHandler } from './interactions.js';
import { sendWelcomeDm } from './onboarding/welcome.js';
import { createWebhookServer } from './releases/server.js';
import { onTicketMessage } from './tickets/service.js';
import { runLayoutTasks } from './startup.js';
import { LayoutStore } from './layout.js';

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadOpsConfig();
  const logger = createLogger('ops', { level: config.logLevel });
  const prisma = createPrisma(config.databaseUrl);

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
  const ctx: OpsContext = { config, logger, prisma, client, layout };
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
    try {
      await guild.members.fetch();
    } catch (error) {
      logger.error({ err: error }, 'could not cache guild members');
    }
    if (ctx.layout.current) {
      await runLayoutTasks(ctx, guild);
    } else {
      logger.warn(
        { missing: ctx.layout.missing },
        'server is not set up yet: an administrator should run /setup server',
      );
    }
    logger.info('startup complete');
  });

  client.on(Events.InteractionCreate, createInteractionHandler(ctx, commands));
  client.on(Events.GuildMemberAdd, (member) => void sendWelcomeDm(member, ctx));
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
