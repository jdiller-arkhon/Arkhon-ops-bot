import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directory holding the slash command modules (src/commands under tsx, dist/commands when built). */
export const COMMANDS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'commands');
