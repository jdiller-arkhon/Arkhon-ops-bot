// node shot.mjs page.html out.png width height: screenshots #art with Playwright's Chromium.
// Needs `playwright` resolvable (e.g. npx -p playwright node shot.mjs ...). Set CHROMIUM_PATH to
// use an installed Chromium instead of Playwright's download.
import { chromium } from 'playwright';

const [, , page, out, w, h] = process.argv;
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const p = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
await p.goto('file://' + page);
await p.evaluate('document.fonts.ready');
await p.locator('#art').screenshot({ path: out });
await browser.close();
