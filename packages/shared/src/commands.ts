import { readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  Collection,
  REST,
  Routes,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { Logger } from 'pino';

/**
 * A slash command module. Each file in a bot's commands directory exports `data` and `execute`
 * (named exports) and is picked up automatically by loadCommands().
 */
export interface Command<Ctx = unknown> {
  data: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  execute(interaction: ChatInputCommandInteraction, ctx: Ctx): Promise<void>;
  /** Optional: answers autocomplete for the command's options. */
  autocomplete?(interaction: AutocompleteInteraction, ctx: Ctx): Promise<void>;
}

export type CommandRegistry<Ctx = unknown> = Collection<string, Command<Ctx>>;

function isCommand(value: unknown): value is Command {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Command>;
  return (
    typeof candidate.execute === 'function' &&
    typeof candidate.data === 'object' &&
    candidate.data !== null &&
    typeof candidate.data.name === 'string' &&
    typeof candidate.data.toJSON === 'function'
  );
}

/**
 * Imports every command module in `dir` (.js when compiled, .ts under tsx) and returns them
 * keyed by command name. Throws if a file does not export a valid command or names collide.
 */
export async function loadCommands<Ctx>(dir: string): Promise<CommandRegistry<Ctx>> {
  const registry: CommandRegistry<Ctx> = new Collection();
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => ['.js', '.ts', '.mjs'].includes(extname(name)))
    .filter((name) => !name.endsWith('.d.ts') && !name.includes('.test.'))
    .sort();

  for (const file of files) {
    const mod: unknown = await import(pathToFileURL(join(dir, file)).href);
    if (!isCommand(mod)) {
      throw new Error(`Command file ${file} must export "data" and "execute"`);
    }
    const name = mod.data.name;
    if (registry.has(name)) throw new Error(`Duplicate command name "${name}" in ${file}`);
    registry.set(name, mod as Command<Ctx>);
  }
  return registry;
}

export interface DeployCommandsOptions {
  token: string;
  clientId: string;
  /** When set, commands are registered to this guild only (instant, for development). */
  guildId?: string;
  commands: Iterable<Command<never>>;
  logger: Logger;
}

/** Registers commands with Discord, replacing whatever was registered before. */
export async function deployCommands(options: DeployCommandsOptions): Promise<number> {
  const body = [...options.commands].map((command) => command.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(options.token);
  const route = options.guildId
    ? Routes.applicationGuildCommands(options.clientId, options.guildId)
    : Routes.applicationCommands(options.clientId);
  await rest.put(route, { body });
  options.logger.info(
    { count: body.length, scope: options.guildId ? `guild:${options.guildId}` : 'global' },
    'slash commands deployed',
  );
  return body.length;
}
