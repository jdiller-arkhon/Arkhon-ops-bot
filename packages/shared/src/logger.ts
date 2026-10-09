import { pino, type Logger, type LevelWithSilent } from 'pino';

export type { Logger } from 'pino';

export interface LoggerOptions {
  level?: LevelWithSilent;
}

/** Structured JSON logger tagged with the bot name. Pipe through `pino-pretty` for local reading. */
export function createLogger(botName: string, options: LoggerOptions = {}): Logger {
  const level = options.level ?? (process.env.LOG_LEVEL as LevelWithSilent | undefined) ?? 'info';
  return pino({
    level,
    base: { bot: botName },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['token', '*.token', 'headers.authorization', '*.headers.authorization'],
      censor: '[redacted]',
    },
  });
}
