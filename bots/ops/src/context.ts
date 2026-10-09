import type { Logger } from '@arkhon/shared';
import type { PrismaClient } from '@prisma/client';
import type { Client } from 'discord.js';
import type { OpsConfig } from './config.js';

/** Everything a handler needs. Passed explicitly instead of using module-level singletons. */
export interface OpsContext {
  config: OpsConfig;
  logger: Logger;
  prisma: PrismaClient;
  client: Client;
}
