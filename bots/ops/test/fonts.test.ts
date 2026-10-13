import { describe, expect, it } from 'vitest';
import {
  allChannels,
  BLUEPRINT,
  CHANNEL_NAME_STYLE,
  withChannelNameStyle,
} from '../src/setup/blueprint.js';
import { foldStyledName, styleName } from '../src/setup/fonts.js';
import { normalizeName } from '../src/setup/plan.js';

describe('channel name lettering', () => {
  it('renders small caps and leaves emoji, separators and dashes alone', () => {
    expect(styleName('👋・welcome', 'smallCaps')).toBe('👋・ᴡᴇʟᴄᴏᴍᴇ');
    expect(styleName('🧭・certa-help', 'smallCaps')).toBe('🧭・ᴄᴇʀᴛᴀ-ʜᴇʟᴘ');
    expect(styleName('🎙️ Office Hours', 'smallCaps')).toBe('🎙️ ᴏꜰꜰɪᴄᴇ ʜᴏᴜʀꜱ');
    expect(styleName('👋・welcome', 'plain')).toBe('👋・welcome');
  });

  it('folds back to plain text for every letter', () => {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    expect(foldStyledName(styleName(alphabet, 'smallCaps'))).toBe(alphabet);
  });

  it('styled and plain names normalize to the same value, so existing channels are adopted', () => {
    expect(normalizeName('🎫・ꜱᴜᴘᴘᴏʀᴛ')).toBe(normalizeName('🎫・support'));
    expect(normalizeName('🔊 ʟᴏᴜɴɢᴇ')).toBe(normalizeName('🔊 Lounge'));
  });

  it('applies the configured style to channels only, not categories', () => {
    expect(CHANNEL_NAME_STYLE).toBe('smallCaps');
    expect(allChannels().every((c) => !/[a-z]/.test(c.name))).toBe(true);
    expect(BLUEPRINT.categories.map((c) => c.name)).toContain('ARKHON INDUSTRIES');
    const plain = withChannelNameStyle(BLUEPRINT, 'plain');
    expect(plain.categories[0]?.channels[0]?.name).toBe(BLUEPRINT.categories[0]?.channels[0]?.name);
  });

  it('keeps every channel name within Discord limits after styling', () => {
    for (const channel of allChannels()) expect([...channel.name].length).toBeLessThanOrEqual(100);
  });
});
