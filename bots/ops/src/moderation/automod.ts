import {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  type AutoModerationActionOptions,
  type AutoModerationRule,
  type Collection,
  type Guild,
} from 'discord.js';
import type { OpsConfig } from '../config.js';
import type { Logger } from '@arkhon/shared';

export const RULE_NAMES = {
  mentionSpam: 'Arkhon: mention spam',
  inviteLinks: 'Arkhon: invite links (non-staff)',
  keywords: 'Arkhon: blocked keywords',
} as const;

/** Matches discord.gg/x, discord.com/invite/x and discordapp.com/invite/x. */
export const INVITE_REGEX = String.raw`(?:https?://)?(?:www\.)?(?:discord(?:app)?\.com/invite|discord\.gg)/[a-z0-9-]+`;

export interface DesiredRule {
  name: string;
  triggerType: AutoModerationRuleTriggerType;
  triggerMetadata: {
    mentionTotalLimit?: number;
    mentionRaidProtectionEnabled?: boolean;
    regexPatterns?: string[];
    keywordFilter?: string[];
  };
  exemptRoles: string[];
}

/** The rules the bot maintains, derived from config. Pure so it can be inspected in tests. */
export function desiredRules(config: OpsConfig): DesiredRule[] {
  const staffRoles = Object.values(config.roles.staff);
  const rules: DesiredRule[] = [
    {
      name: RULE_NAMES.mentionSpam,
      triggerType: AutoModerationRuleTriggerType.MentionSpam,
      triggerMetadata: {
        mentionTotalLimit: config.automod.mentionLimit,
        mentionRaidProtectionEnabled: true,
      },
      exemptRoles: staffRoles,
    },
    {
      name: RULE_NAMES.inviteLinks,
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: { regexPatterns: [INVITE_REGEX] },
      exemptRoles: staffRoles,
    },
  ];
  if (config.automod.keywords.length > 0) {
    rules.push({
      name: RULE_NAMES.keywords,
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: { keywordFilter: config.automod.keywords },
      exemptRoles: [],
    });
  }
  return rules;
}

function sameList(a: readonly string[] = [], b: readonly string[] = []): boolean {
  return a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');
}

/**
 * Creates the AutoMod rules that do not exist yet (matched by name). The keyword rule's word list
 * is kept in sync with AUTOMOD_KEYWORDS so editing config takes effect on restart.
 */
export async function ensureAutoModRules(
  guild: Guild,
  config: OpsConfig,
  logger: Logger,
): Promise<void> {
  const existing = await guild.autoModerationRules.fetch();
  const actions: AutoModerationActionOptions[] = [
    {
      type: AutoModerationActionType.BlockMessage,
      metadata: { customMessage: 'Blocked by Arkhon AutoMod.' },
    },
    {
      type: AutoModerationActionType.SendAlertMessage,
      metadata: { channel: config.channels.modLog },
    },
  ];

  for (const rule of desiredRules(config)) {
    try {
      await ensureRule(guild, existing, rule, actions, logger);
    } catch (error) {
      logger.error({ err: error, rule: rule.name }, 'automod rule could not be ensured');
    }
  }
}

async function ensureRule(
  guild: Guild,
  existing: Collection<string, AutoModerationRule>,
  rule: DesiredRule,
  actions: AutoModerationActionOptions[],
  logger: Logger,
): Promise<void> {
  // Discord allows a single mention-spam rule per server, so reuse one made by hand.
  const current =
    existing.find((r) => r.name === rule.name) ??
    (rule.triggerType === AutoModerationRuleTriggerType.MentionSpam
      ? existing.find((r) => r.triggerType === AutoModerationRuleTriggerType.MentionSpam)
      : undefined);

  if (!current) {
    await guild.autoModerationRules.create({
      name: rule.name,
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: rule.triggerType,
      triggerMetadata: rule.triggerMetadata,
      actions,
      exemptRoles: rule.exemptRoles,
      enabled: true,
      reason: 'Arkhon Ops Bot startup',
    });
    logger.info({ rule: rule.name }, 'automod rule created');
    return;
  }
  const keywords = rule.triggerMetadata.keywordFilter;
  if (keywords && !sameList(current.triggerMetadata.keywordFilter, keywords)) {
    await current.setKeywordFilter(keywords, 'AUTOMOD_KEYWORDS changed');
    logger.info({ rule: rule.name, count: keywords.length }, 'automod keywords synced');
    return;
  }
  logger.debug({ rule: rule.name, existing: current.name }, 'automod rule present');
}
