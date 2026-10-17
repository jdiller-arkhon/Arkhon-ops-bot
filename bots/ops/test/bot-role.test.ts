import { describe, expect, it } from 'vitest';
import { botsMissingRole } from '../src/onboarding/bot-role.js';
import { pendingBlueprintMessage } from '../src/setup/notice.js';

const member = (id: string, bot: boolean, roles: string[] = []) => ({
  id,
  user: { bot },
  roles: { cache: { has: (role: string) => roles.includes(role) } },
});

describe('botsMissingRole', () => {
  it('picks bots without the role and never people', () => {
    const members = [member('a', true), member('b', true, ['sys']), member('c', false)];
    expect(botsMissingRole(members, 'sys').map((m) => m.id)).toEqual(['a']);
  });
});

describe('pendingBlueprintMessage', () => {
  it('names what is missing and points to /setup server', () => {
    const text = pendingBlueprintMessage([
      { key: 'role.bots', kind: 'role', name: 'Arkhon Systems', action: 'create' },
    ]);
    expect(text).toContain('**1** item the server');
    expect(text).toContain('Arkhon Systems');
    expect(text).toContain('/setup server');
  });
});
