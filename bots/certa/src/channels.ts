import type { PrismaClient } from '@prisma/client';
import type { CertaConfig } from './config.js';

/**
 * Blueprint keys of the channels this bot posts in. The Ops bot's /setup server creates them and
 * stores their ids in ops_server_resources (bots/ops/src/setup/blueprint.ts); this bot only reads
 * that table. CERTA_*_CHANNEL_ID overrides win, as in the Ops bot's LayoutStore.
 */
export const CHANNEL_KEYS = {
  flightLogs: 'channel.certaFlightLogs',
  preflight: 'channel.certaPreflight',
  home: 'channel.certaGeneral',
} as const;

export type CertaChannel = keyof typeof CHANNEL_KEYS;
export type CertaChannels = Partial<Record<CertaChannel, string>>;

/** Pure merge: env overrides first, then the ids /setup server stored. */
export function mergeChannels(
  stored: Partial<Record<string, string>>,
  overrides: CertaConfig['channelOverrides'],
): CertaChannels {
  const out: CertaChannels = {};
  for (const [name, key] of Object.entries(CHANNEL_KEYS) as [CertaChannel, string][]) {
    const id = overrides[name] ?? stored[key];
    if (id) out[name] = id;
  }
  return out;
}

/** Reads the current ids on every call, so a re-run of /setup server applies without a restart. */
export async function resolveChannels(
  prisma: PrismaClient,
  overrides: CertaConfig['channelOverrides'],
): Promise<CertaChannels> {
  const rows = await prisma.opsServerResource.findMany({
    where: { key: { in: Object.values(CHANNEL_KEYS) } },
    select: { key: true, discordId: true },
  });
  return mergeChannels(Object.fromEntries(rows.map((r) => [r.key, r.discordId])), overrides);
}
