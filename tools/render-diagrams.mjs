// tools/diagrams/*.html を日本語版と英語版の PNG に書き出す（docs/images/<名前>.<ja|en>.png）
// svg に data-themes があれば、テーマごとにも書き出す（docs/images/<名前>.<テーマ>.<ja|en>.png）
// 使い方: node tools/render-diagrams.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, 'diagrams');
const outDir = path.join(here, '..', 'docs', 'images');
fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
  for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(srcDir, file), 'utf8');
    const themes = html.match(/data-themes="([^"]+)"/)?.[1].split(' ') ?? [null];
    for (const theme of themes) {
      for (const lang of ['ja', 'en']) {
        const query = `?lang=${lang}${theme ? `&theme=${theme}` : ''}`;
        await page.goto(`${pathToFileURL(path.join(srcDir, file)).href}${query}`, { waitUntil: 'networkidle0' });
        await page.evaluate(() => document.fonts.ready);
        const name = [path.basename(file, '.html'), theme, lang].filter(Boolean).join('.');
        const out = path.join(outDir, `${name}.png`);
        await (await page.$('svg')).screenshot({ path: out });
        console.log(path.relative(process.cwd(), out));
      }
    }
  }
} finally {
  await browser.close();
}
