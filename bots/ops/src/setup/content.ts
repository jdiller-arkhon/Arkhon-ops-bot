import { arkhonEmbed } from '@arkhon/shared';
import type { BaseMessageOptions } from 'discord.js';
import type { ResourceIds } from '../layout.js';

const mention = (ids: ResourceIds, key: string, fallback: string) =>
  ids[key] ? `<#${ids[key]}>` : fallback;

/** Pinned overview in #welcome. Channel mentions resolve to whatever /setup created. */
export function buildWelcomeMessage(ids: ResourceIds): BaseMessageOptions {
  const c = (key: string, fallback: string) => mention(ids, `channel.${key}`, fallback);
  const header = arkhonEmbed({
    title: 'Welcome to the Arkhon Industries pilot community',
    description: [
      'This is the official home for pilots and teams using **Certa** and **Argus**: product support,',
      'release notes, and a direct line to the people building the tools you fly with.',
    ].join(' '),
  });
  const products = arkhonEmbed({
    title: 'Our products',
    fields: [
      {
        name: '🛩️ Certa',
        value: 'Drone flight operations and compliance logbook: plan, log, and prove every flight.',
      },
      {
        name: '👁️ Argus',
        value: 'The Argus platform, with its own channels, support team and releases.',
      },
    ],
  });
  const navigation = arkhonEmbed({
    title: 'Finding your way around',
    fields: [
      {
        name: '1. Read the rules',
        value: `${c('rules', '#rules')} — short, and they keep this place useful.`,
      },
      {
        name: '2. Pick your products',
        value: `${c('startHere', '#start-here')} — unlocks the Certa and/or Argus channels.`,
      },
      {
        name: '3. Say hello',
        value: `${c('introductions', '#introductions')} — what you fly and what you use our tools for.`,
      },
      {
        name: 'Need help?',
        value: `${c('support', '#support')} — open a private ticket. Only you and the product team can see it.`,
      },
      {
        name: 'Have an idea or found a bug?',
        value: `${c('feedback', '#feedback')} — post it, tag the product, upvote others. The best ones become tracked issues.`,
      },
      {
        name: 'Stay current',
        value: `${c('announcements', '#announcements')} — release notes. You are only pinged for the products you picked.`,
      },
    ],
  });
  return { embeds: [header, products, navigation] };
}

export const RULES: { title: string; body: string }[] = [
  {
    title: 'Be professional and respectful',
    body: 'Treat everyone as a colleague. No harassment, discrimination, personal attacks or hate speech.',
  },
  {
    title: 'Keep it on topic',
    body: 'Use the channel that fits. Product questions go in the product channels; off-topic chat stays in general.',
  },
  {
    title: 'No spam or self-promotion',
    body: 'No unsolicited ads, referral links, Discord invites or repeated messages. DMing members to sell is not allowed.',
  },
  {
    title: 'Protect privacy and data',
    body: 'Never post personal data, client information, credentials, or logs and footage that identify people or sensitive sites.',
  },
  {
    title: 'Fly safe and legal',
    body: 'Do not promote unsafe or unlawful operations. Follow the aviation rules where you fly. Advice here is not legal or regulatory advice.',
  },
  {
    title: 'Respect the pilot program',
    body: 'Pre-release features and builds shared here are confidential. Do not share screenshots or details outside this server.',
  },
  {
    title: 'Support goes through tickets',
    body: 'For account or product issues, open a ticket in support instead of DMing staff. It is faster and nothing gets lost.',
  },
  {
    title: 'Follow Discord’s Terms and Guidelines',
    body: 'discord.com/terms and discord.com/guidelines apply here too.',
  },
];

export function buildRulesMessage(ids: ResourceIds): BaseMessageOptions {
  const rules = arkhonEmbed({
    title: 'Server rules',
    description: RULES.map((rule, i) => `**${i + 1}. ${rule.title}**\n${rule.body}`).join('\n\n'),
  });
  const enforcement = arkhonEmbed({
    title: 'Enforcement',
    description: [
      'Moderators may remove content, warn, time out or remove members at their discretion.',
      'Serious or repeated violations lead to a permanent ban.',
      `Questions about a moderation decision? Open a ticket in ${mention(ids, 'channel.support', '#support')}.`,
    ].join('\n'),
  });
  return { embeds: [rules, enforcement] };
}
