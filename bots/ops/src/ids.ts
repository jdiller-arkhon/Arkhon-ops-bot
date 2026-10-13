/**
 * Component custom ids. Format: "ops:<feature>:<action>[:<arg>]".
 * Buttons on persistent panels keep working across restarts because routing is by id only.
 */
import type { Product } from '@arkhon/shared';

export const CUSTOM_ID_PREFIX = 'ops';

export const ids = {
  ticketOpen: (product: Product) => `ops:ticket:open:${product}`,
  ticketModal: (product: Product) => `ops:ticket:modal:${product}`,
  ticketClaim: (ticketId: number) => `ops:ticket:claim:${ticketId}`,
  ticketWaiting: (ticketId: number) => `ops:ticket:waiting:${ticketId}`,
  ticketClose: (ticketId: number) => `ops:ticket:close:${ticketId}`,
  role: (choice: 'certa' | 'argus' | 'both') => `ops:role:${choice}`,
  setupConfirm: (token: string) => `ops:setup:confirm:${token}`,
  setupCancel: (token: string) => `ops:setup:cancel:${token}`,
} as const;

export interface ParsedCustomId {
  feature: string;
  action: string;
  arg?: string;
}

export function parseCustomId(customId: string): ParsedCustomId | undefined {
  const [prefix, feature, action, arg] = customId.split(':');
  if (prefix !== CUSTOM_ID_PREFIX || !feature || !action) return undefined;
  return arg === undefined ? { feature, action } : { feature, action, arg };
}

export const TICKET_FIELDS = {
  subject: 'subject',
  description: 'description',
  appVersion: 'appVersion',
} as const;
