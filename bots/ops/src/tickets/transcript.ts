import { productLabel, type Product } from '@arkhon/shared';

export interface TranscriptMessage {
  authorTag: string;
  authorId: string;
  bot: boolean;
  createdAt: Date;
  content: string;
  attachments: string[];
  embeds: string[];
}

export interface TranscriptTicket {
  id: number;
  product: Product;
  subject: string;
  description: string;
  appVersion: string | null;
  userTag: string;
  userId: string;
  createdAt: Date;
  closedAt: Date;
  closedByTag: string;
  claimedByTag: string | null;
}

function stamp(date: Date): string {
  return date
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, ' UTC');
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

/** Plain-text transcript. Messages are printed oldest first regardless of input order. */
export function formatTranscript(
  ticket: TranscriptTicket,
  messages: readonly TranscriptMessage[],
): string {
  const lines: string[] = [
    `Arkhon Industries — ${productLabel(ticket.product)} support ticket #${ticket.id}`,
    '='.repeat(60),
    `Subject:     ${ticket.subject}`,
    `Opened by:   ${ticket.userTag} (${ticket.userId})`,
    `App version: ${ticket.appVersion ?? 'not provided'}`,
    `Claimed by:  ${ticket.claimedByTag ?? 'unclaimed'}`,
    `Opened:      ${stamp(ticket.createdAt)}`,
    `Closed:      ${stamp(ticket.closedAt)} by ${ticket.closedByTag}`,
    '',
    'Description:',
    indent(ticket.description),
    '',
    '-'.repeat(60),
    `Messages (${messages.length})`,
    '-'.repeat(60),
  ];

  const ordered = [...messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const message of ordered) {
    lines.push(`[${stamp(message.createdAt)}] ${message.authorTag}${message.bot ? ' [bot]' : ''}:`);
    if (message.content) lines.push(indent(message.content));
    for (const embed of message.embeds) lines.push(indent(`[embed] ${embed}`));
    for (const url of message.attachments) lines.push(indent(`[attachment] ${url}`));
    if (!message.content && message.embeds.length === 0 && message.attachments.length === 0) {
      lines.push(indent('(no text content)'));
    }
  }
  lines.push('', `End of transcript for ticket #${ticket.id}.`, '');
  return lines.join('\n');
}
