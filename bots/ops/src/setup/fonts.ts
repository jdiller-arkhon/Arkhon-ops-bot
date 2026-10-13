/**
 * Discord has no custom fonts, so channel names are styled with Unicode look-alike letters.
 * Small caps keep the names readable and subtle: "👋・welcome" -> "👋・ᴡᴇʟᴄᴏᴍᴇ".
 * Emoji, digits, separators and dashes are left untouched.
 */
export type ChannelNameStyle = 'smallCaps' | 'plain';

const SMALL_CAPS: Record<string, string> = {
  a: 'ᴀ',
  b: 'ʙ',
  c: 'ᴄ',
  d: 'ᴅ',
  e: 'ᴇ',
  f: 'ꜰ',
  g: 'ɢ',
  h: 'ʜ',
  i: 'ɪ',
  j: 'ᴊ',
  k: 'ᴋ',
  l: 'ʟ',
  m: 'ᴍ',
  n: 'ɴ',
  o: 'ᴏ',
  p: 'ᴘ',
  q: 'ǫ',
  r: 'ʀ',
  s: 'ꜱ',
  t: 'ᴛ',
  u: 'ᴜ',
  v: 'ᴠ',
  w: 'ᴡ',
  x: 'x',
  y: 'ʏ',
  z: 'ᴢ',
};

const FROM_SMALL_CAPS: Record<string, string> = Object.fromEntries(
  Object.entries(SMALL_CAPS).map(([ascii, styled]) => [styled, ascii]),
);

export function styleName(name: string, style: ChannelNameStyle): string {
  if (style === 'plain') return name;
  return [...name.toLowerCase()].map((ch) => SMALL_CAPS[ch] ?? ch).join('');
}

/** Maps small-caps letters back to ASCII so styled and plain names compare equal. */
export function foldStyledName(name: string): string {
  return [...name].map((ch) => FROM_SMALL_CAPS[ch] ?? ch).join('');
}
