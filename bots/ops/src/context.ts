import type { Logger } from '@arkhon/shared';
import type { PrismaClient } from '@prisma/client';
import type { Client } from 'discord.js';
import type { OpsConfig } from './config.js';
import type { LayoutStore } from './layout.js';

/** Everything a handler needs. Passed explicitly instead of using module-level singletons. */
export interface OpsContext {
  config: OpsConfig;
  logger: Logger;
  prisma: PrismaClient;
  client: Client;
  /** Channel and role ids, from /setup server or env overrides. */
  layout: LayoutStore;
}
