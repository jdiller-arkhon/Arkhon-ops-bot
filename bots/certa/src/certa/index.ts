import type { PrismaClient } from '@prisma/client';
import type { CertaConfig } from '../config.js';
import type { CertaClient } from './client.js';
import { HttpCertaClient } from './http-client.js';
import { MockCertaClient } from './mock-client.js';

/** Picks the Certa client from CERTA_API_MODE. */
export function createCertaClient(config: CertaConfig, prisma: PrismaClient): CertaClient {
  if (config.api.mode === 'mock') {
    return new MockCertaClient(prisma, { timezone: config.timezone });
  }
  return new HttpCertaClient({ baseUrl: config.api.baseUrl, token: config.api.token });
}
