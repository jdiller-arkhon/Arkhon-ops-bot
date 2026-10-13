import type { Logger } from '@arkhon/shared';
import type { PrismaClient } from '@prisma/client';
import type { Client } from 'discord.js';
import type { OpsConfig } from './config.js';
import type { LayoutStore } from './layout.js';
import type { CommunityApi } from './verification/api.js';
import type { AttemptLimiter, RaidShield } from './verification/shield.js';

/** Everything a handler needs. Passed explicitly instead of using module-level singletons. */
export interface OpsContext {
  config: OpsConfig;
  logger: Logger;
  prisma: PrismaClient;
  client: Client;
  /** Channel and role ids, from /setup server or env overrides. */
  layout: LayoutStore;
  /** Member verification and alt/raid shield state. */
  security: {
    /** Undefined when ARKHON_COMMUNITY_API_TOKEN / MEMBER_WEBHOOK_SECRET are not set. */
    api: CommunityApi | undefined;
    attempts: AttemptLimiter;
    raid: RaidShield;
  };
}
