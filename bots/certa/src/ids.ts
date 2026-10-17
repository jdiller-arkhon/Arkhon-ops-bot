/**
 * Component custom ids. Format: "certa:<feature>:<action>[:<arg>]". Routing is by id only, so
 * buttons keep working across restarts.
 */
import type { MissionType } from './certa/types.js';

export const CUSTOM_ID_PREFIX = 'certa';

export const ids = {
  logModal: (mission: MissionType) => `certa:log:modal:${mission}`,
  logShare: (flightId: string) => `certa:log:share:${flightId}`,
} as const;

export interface ParsedCustomId {
  feature: string;
  action: string;
  arg?: string;
}

export function parseCustomId(customId: string): ParsedCustomId | undefined {
  const [prefix, feature, action, ...rest] = customId.split(':');
  if (prefix !== CUSTOM_ID_PREFIX || !feature || !action) return undefined;
  return rest.length === 0 ? { feature, action } : { feature, action, arg: rest.join(':') };
}

/** Discord limits custom ids to 100 characters. */
export function fitsCustomId(customId: string): boolean {
  return customId.length <= 100;
}

export const LOG_FIELDS = {
  date: 'date',
  location: 'location',
  aircraft: 'aircraft',
  duration: 'duration',
  notes: 'notes',
} as const;
