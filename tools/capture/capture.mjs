// シナリオ 1 回分の時間範囲で Grafana のパネルを PNG に書き出す
// 使い方: node tools/capture/capture.mjs scenarios/00-no-defense/results
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const GRAFANA = process.env.GRAFANA_URL || 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// 記事に貼る想定のパネル（id は k8s/observability/dashboards/lab.json と対応）
const PANELS = [
  { id: 1, file: 'threads' },
  { id: 2, file: 'success' },
  { id: 3, file: 'latency' },
  { id: 4, file: 'hikari' },
  { id: 5, file: 'orders-status' },
  { id: 6, file: 'resilience4j' },
  { id: 7, file: 'cpu' },
  { id: 8, file: 'payment-api-threads' },
  { id: 9, file: 'uptime' },
  { id: 10, file: 'k6-dropped' },
  { id: 11, file: 'payment-calls' },
  { id: 12, file: 'littles-law' },
];

const resultsDir = process.argv[2];
if (!resultsDir) {
  console.error('usage: node tools/capture/capture.mjs <scenarios/xx/results>');
  process.exit(1);
}
const score = JSON.parse(fs.readFileSync(path.join(resultsDir, 'score.json'), 'utf8'));
const { normal_start: from, end: to } = score.timeline;
const outDir = path.join(resultsDir, 'panels');
fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
try {
  const page = await browser.newPage();
  // Zenn の本文幅で読める大きさ。2 倍で撮って高解像度の画面でもにじまないようにする
  await page.setViewport({ width: 960, height: 420, deviceScaleFactor: 2 });
  for (const { id, file } of PANELS) {
    const url = `${GRAFANA}/d-solo/lab/lab?orgId=1&panelId=${id}&from=${from * 1000}&to=${to * 1000}&theme=light`;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 });
    await new Promise((r) => setTimeout(r, 1500));
    // 埋め込み表示の右上に出る「Powered by Grafana」を消す
    await page.evaluate(() => {
      let badge = [...document.querySelectorAll('div')].find((e) => e.textContent?.trim() === 'Powered by');
      while (badge?.parentElement?.textContent?.trim() === 'Powered by') badge = badge.parentElement;
      if (badge) badge.style.display = 'none';
    });
    const out = path.join(outDir, `${file}.png`);
    await page.screenshot({ path: out });
    console.log(out);
  }
} finally {
  await browser.close();
}
