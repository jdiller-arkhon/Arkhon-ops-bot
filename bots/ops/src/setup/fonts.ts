/**
 * Discord has no custom fonts, so channel names are styled with Unicode look-alike alphabets
 * (the Mathematical Alphanumeric Symbols block and small-caps letters). They render on desktop and
 * mobile without anything installed. Emoji, separators and dashes are left untouched.
 *
 *   monospace   👋・𝚠𝚎𝚕𝚌𝚘𝚖𝚎
 *   sansBold    👋・𝘄𝗲𝗹𝗰𝗼𝗺𝗲
 *   sansItalic  👋・𝘸𝘦𝘭𝘤𝘰𝘮𝘦
 *   smallCaps   👋・ᴡᴇʟᴄᴏᴍᴇ
 *   plain       👋・welcome
 */
export const CHANNEL_NAME_STYLES = [
  'monospace',
  'sansBold',
  'sansItalic',
  'smallCaps',
  'plain',
] as const;
export type ChannelNameStyle = (typeof CHANNEL_NAME_STYLES)[number];

/** First code point of the lowercase a-z run and the 0-9 run for each math alphabet. */
const MATH_ALPHABETS: Record<
  'monospace' | 'sansBold' | 'sansItalic',
  { lower: number; digits?: number }
> = {
  monospace: { lower: 0x1d68a, digits: 0x1d7f6 },
  sansBold: { lower: 0x1d5ee, digits: 0x1d7ec },
  sansItalic: { lower: 0x1d622 },
};

const SMALL_CAPS: Record<string, string> = Object.fromEntries(
  [...'abcdefghijklmnopqrstuvwxyz'].map((ch, i) => [
    ch,
    [...'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ'][i] as string,
  ]),
);

const FROM_SMALL_CAPS: Record<string, string> = Object.fromEntries(
  Object.entries(SMALL_CAPS).map(([ascii, styled]) => [styled, ascii]),
);

export function styleName(name: string, style: ChannelNameStyle): string {
  // Fold first so restyling an already-styled name works.
  const base = foldStyledName(name);
  if (style === 'plain') return base;
  const lower = base.toLowerCase();
  if (style === 'smallCaps') return [...lower].map((ch) => SMALL_CAPS[ch] ?? ch).join('');
  const alphabet = MATH_ALPHABETS[style];
  return [...lower]
    .map((ch) => {
      if (ch >= 'a' && ch <= 'z')
        return String.fromCodePoint(alphabet.lower + ch.charCodeAt(0) - 97);
      if (alphabet.digits !== undefined && ch >= '0' && ch <= '9') {
        return String.fromCodePoint(alphabet.digits + ch.charCodeAt(0) - 48);
      }
      return ch;
    })
    .join('');
}

/**
 * Maps any supported style back to plain ASCII so styled and plain names compare equal.
 * Math alphabets fold through NFKC; small caps have no compatibility mapping, so map them here.
 */
export function foldStyledName(name: string): string {
  return [...name.normalize('NFKC')].map((ch) => FROM_SMALL_CAPS[ch] ?? ch).join('');
}
