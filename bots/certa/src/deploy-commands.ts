import {
  baseEnvSchema,
  ConfigError,
  createLogger,
  deployCommands,
  loadCommands,
  loadConfig,
  loadDotEnv,
  snowflake,
} from '@arkhon/shared';
import { z } from 'zod';
import { COMMANDS_DIR } from './commands-dir.js';
import type { CertaContext } from './context.js';

const schema = baseEnvSchema.omit({ DISCORD_TOKEN: true, DISCORD_CLIENT_ID: true }).extend({
  CERTA_DISCORD_TOKEN: z.string().min(50, 'does not look like a bot token'),
  CERTA_DISCORD_CLIENT_ID: snowflake,
});

/**
 * Registers the Certa bot's slash commands. Development: to DISCORD_GUILD_ID (instant).
 * Production (NODE_ENV=production): globally. Pass --global or --guild to override.
 */
async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig(schema);
  const logger = createLogger('certa-deploy', { level: config.LOG_LEVEL });
  const args = new Set(process.argv.slice(2));
  const global = args.has('--global') || (config.NODE_ENV === 'production' && !args.has('--guild'));
  const commands = await loadCommands<CertaContext>(COMMANDS_DIR);
  await deployCommands({
    token: config.CERTA_DISCORD_TOKEN,
    clientId: config.CERTA_DISCORD_CLIENT_ID,
    ...(global ? {} : { guildId: config.DISCORD_GUILD_ID }),
    commands: commands.values(),
    logger,
  });
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) console.error(error.message);
  else console.error(error);
  process.exit(1);
});
