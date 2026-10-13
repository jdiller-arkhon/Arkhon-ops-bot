import { AutoModerationRuleTriggerType } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { loadOpsConfig } from '../src/config.js';
import { desiredRules, INVITE_REGEX, RULE_NAMES } from '../src/moderation/automod.js';
import { fixtureLayout, validOpsEnv } from './fixtures.js';

const layout = fixtureLayout().require();

describe('desiredRules', () => {
  it('always includes mention spam and invite blocking, exempting staff', () => {
    const config = loadOpsConfig({ ...validOpsEnv, AUTOMOD_MENTION_LIMIT: '7' });
    const rules = desiredRules(config, layout);
    expect(rules.map((r) => r.name)).toEqual([RULE_NAMES.mentionSpam, RULE_NAMES.inviteLinks]);
    expect(rules[0]?.triggerType).toBe(AutoModerationRuleTriggerType.MentionSpam);
    expect(rules[0]?.triggerMetadata.mentionTotalLimit).toBe(7);
    expect(rules[1]?.exemptRoles).toEqual([layout.roles.staff.certa, layout.roles.staff.argus]);
  });

  it('adds the keyword rule only when keywords are configured', () => {
    const rules = desiredRules(
      loadOpsConfig({ ...validOpsEnv, AUTOMOD_KEYWORDS: 'free nitro,scam*' }),
      layout,
    );
    expect(rules[2]?.triggerMetadata.keywordFilter).toEqual(['free nitro', 'scam*']);
  });

  it('invite regex matches the common invite forms', () => {
    const re = new RegExp(INVITE_REGEX, 'i');
    for (const text of [
      'discord.gg/abc',
      'https://discord.com/invite/x-y',
      'discordapp.com/invite/Z9',
    ]) {
      expect(re.test(text)).toBe(true);
    }
    expect(re.test('https://discord.com/channels/1/2')).toBe(false);
  });
});
