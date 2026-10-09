import {
  baseEnvSchema,
  ConfigError,
  createLogger,
  deployCommands,
  loadConfig,
  loadCommands,
  loadDotEnv,
} from '@arkhon/shared';
import { COMMANDS_DIR } from './commands-dir.js';
import type { OpsContext } from './context.js';

/**
 * Registers slash commands. Development: to DISCORD_GUILD_ID (instant). Production
 * (NODE_ENV=production): globally. Pass --global or --guild to override.
 */
async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig(baseEnvSchema);
  const logger = createLogger('ops-deploy', { level: config.LOG_LEVEL });
  const args = new Set(process.argv.slice(2));
  const global = args.has('--global') || (config.NODE_ENV === 'production' && !args.has('--guild'));
  const commands = await loadCommands<OpsContext>(COMMANDS_DIR);
  await deployCommands({
    token: config.DISCORD_TOKEN,
    clientId: config.DISCORD_CLIENT_ID,
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
