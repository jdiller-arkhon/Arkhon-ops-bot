import type { Logger } from '@arkhon/shared';
import type { PrismaClient } from '@prisma/client';
import type { Client } from 'discord.js';
import type { DateTime } from 'luxon';
import type { CertaClient } from './certa/client.js';
import type { CertaConfig } from './config.js';
import type { PreflightService } from './preflight/service.js';
import type { CertaStore } from './store.js';

/** Everything a handler needs. Passed explicitly instead of using module-level singletons. */
export interface CertaContext {
  config: CertaConfig;
  logger: Logger;
  prisma: PrismaClient;
  client: Client;
  store: CertaStore;
  /** The Certa backend: HttpCertaClient, or MockCertaClient when CERTA_API_MODE=mock. */
  certa: CertaClient;
  preflight: PreflightService;
  /** Current time in CERTA_TIMEZONE. */
  now: () => DateTime;
}
