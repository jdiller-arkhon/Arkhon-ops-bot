import { ConfigError, createLogger, loadCommands, loadDotEnv, openDatabase } from '@arkhon/shared';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { DateTime } from 'luxon';
import { createCertaClient } from './certa/index.js';
import { COMMANDS_DIR } from './commands-dir.js';
import { loadCertaConfig } from './config.js';
import type { CertaContext } from './context.js';
import { createHealthServer } from './health.js';
import { createInteractionHandler } from './interactions.js';
import { createJobs } from './jobs/index.js';
import { startScheduler } from './jobs/scheduler.js';
import { PreflightService } from './preflight/service.js';
import { startPresenceRotation } from './presence.js';
import { CertaStore } from './store.js';

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadCertaConfig();
  const logger = createLogger('certa', { level: config.logLevel });
  const prisma = await openDatabase(config.database, logger);

  // Slash commands, buttons and modals need no privileged intents; DMs are outgoing only.
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    allowedMentions: { parse: [] },
  });
  const ctx: CertaContext = {
    config,
    logger,
    prisma,
    client,
    store: new CertaStore(prisma),
    certa: createCertaClient(config, prisma),
    preflight: new PreflightService({
      thresholds: config.thresholds,
      tfrRadiusNm: config.tfrRadiusNm,
      logger,
    }),
    now: () => DateTime.now().setZone(config.timezone),
  };
  const commands = await loadCommands<CertaContext>(COMMANDS_DIR);
  logger.info({ commands: [...commands.keys()], api: config.api.mode }, 'commands loaded');

  let stopScheduler: (() => void) | undefined;
  let stopPresence: (() => void) | undefined;
  client.once(Events.ClientReady, (ready) => {
    logger.info({ user: ready.user.tag }, 'connected to Discord');
    stopScheduler = startScheduler(createJobs(ctx), {
      timezone: config.timezone,
      store: ctx.store,
      logger,
    });
    stopPresence = startPresenceRotation(ready, ctx);
    logger.info('startup complete');
  });
  client.on(Events.InteractionCreate, createInteractionHandler(ctx, commands));
  client.on(Events.Error, (error) => logger.error({ err: error }, 'discord client error'));

  const server = createHealthServer(() => client.isReady());
  server.listen(config.healthPort, () =>
    logger.info({ port: config.healthPort }, 'health server listening'),
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    stopScheduler?.();
    stopPresence?.();
    server.close();
    await client.destroy();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await prisma.$connect();
  await client.login(config.discord.token);
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) console.error(error.message);
  else console.error('Fatal error during startup:', error);
  process.exit(1);
});
