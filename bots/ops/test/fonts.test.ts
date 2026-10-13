import { describe, expect, it } from 'vitest';
import {
  allChannels,
  BLUEPRINT,
  CHANNEL_NAME_STYLE,
  withChannelNameStyle,
} from '../src/setup/blueprint.js';
import { CHANNEL_NAME_STYLES, foldStyledName, styleName } from '../src/setup/fonts.js';
import { normalizeName } from '../src/setup/plan.js';

describe('channel name lettering', () => {
  it('renders each style and leaves emoji, separators and dashes alone', () => {
    expect(styleName('👋・welcome', 'monospace')).toBe('👋・𝚠𝚎𝚕𝚌𝚘𝚖𝚎');
    expect(styleName('🧭・certa-help', 'monospace')).toBe('🧭・𝚌𝚎𝚛𝚝𝚊-𝚑𝚎𝚕𝚙');
    expect(styleName('🎙️ Office Hours', 'monospace')).toBe('🎙️ 𝚘𝚏𝚏𝚒𝚌𝚎 𝚑𝚘𝚞𝚛𝚜');
    expect(styleName('v2', 'monospace')).toBe('𝚟𝟸');
    expect(styleName('👋・welcome', 'sansBold')).toBe('👋・𝘄𝗲𝗹𝗰𝗼𝗺𝗲');
    expect(styleName('👋・welcome', 'sansItalic')).toBe('👋・𝘸𝘦𝘭𝘤𝘰𝘮𝘦');
    expect(styleName('👋・welcome', 'smallCaps')).toBe('👋・ᴡᴇʟᴄᴏᴍᴇ');
    expect(styleName('👋・welcome', 'plain')).toBe('👋・welcome');
  });

  it.each(CHANNEL_NAME_STYLES)(
    '%s folds back to plain text for every letter and digit',
    (style) => {
      const text = 'abcdefghijklmnopqrstuvwxyz-0123456789';
      expect(foldStyledName(styleName(text, style))).toBe(text);
    },
  );

  it('styled and plain names normalize to the same value, so existing channels are adopted', () => {
    for (const style of CHANNEL_NAME_STYLES) {
      expect(normalizeName(styleName('🎫・support', style))).toBe(normalizeName('🎫・support'));
      expect(normalizeName(styleName('🔊 Lounge', style))).toBe(normalizeName('🔊 Lounge'));
    }
  });

  it('applies the configured style to channels only, not categories', () => {
    expect(CHANNEL_NAME_STYLE).toBe('monospace');
    expect(allChannels().every((c) => !/[a-z]/.test(c.name))).toBe(true);
    expect(BLUEPRINT.categories.map((c) => c.name)).toContain('ARKHON INDUSTRIES');
    const restyled = withChannelNameStyle(BLUEPRINT, 'smallCaps');
    expect(restyled.categories[0]?.channels[0]?.name).toBe('👋・ᴡᴇʟᴄᴏᴍᴇ');
  });

  it('keeps every channel name within Discord limits (counting UTF-16 units, to be safe)', () => {
    for (const channel of allChannels()) expect(channel.name.length).toBeLessThanOrEqual(100);
  });
});
