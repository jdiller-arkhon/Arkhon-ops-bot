import { describe, expect, it } from 'vitest';
import { arkhonEmbed, BRAND_COLOR, footerText, truncate } from '../src/embeds.js';

describe('arkhonEmbed', () => {
  it('uses the brand color and product footer', () => {
    const embed = arkhonEmbed({ title: 'Hello', product: 'certa' }).toJSON();
    expect(embed.color).toBe(BRAND_COLOR);
    expect(embed.footer?.text).toBe('Arkhon Industries · Certa');
    expect(footerText()).toBe('Arkhon Industries');
  });

  it('truncates long descriptions to the Discord limit', () => {
    const embed = arkhonEmbed({ description: 'a'.repeat(5000) }).toJSON();
    expect(embed.description).toHaveLength(4096);
    expect(embed.description?.endsWith('…')).toBe(true);
  });

  it('truncate leaves short strings alone', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
  });
});
