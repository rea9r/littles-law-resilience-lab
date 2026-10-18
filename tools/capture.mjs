// シナリオ 1 回分の時間範囲で Grafana のパネルを PNG に書き出す
// 使い方: node tools/capture.mjs scenarios/00-no-defense/results [--panels threads,hikari] [--around-fault 15,15] [--width 700]
//   --around-fault 前,後: 障害の始まりの前後だけを撮り、<名前>-fault.png に書き出す（立ち上がりを見せる）
//   --around-recovery 前,後: 遅延を外した前後だけを撮り、<名前>-recovery.png に書き出す
//   --width: 撮る幅（既定 960）。Zenn の本文の幅で等倍にするなら 700
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

const [resultsDir, ...rest] = process.argv.slice(2);
if (!resultsDir) {
  console.error('usage: node tools/capture.mjs <scenarios/xx/results> [--panels a,b] [--around-fault 前,後] [--width px]');
  process.exit(1);
}
const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const only = opt('--panels')?.split(',');
const around = opt('--around-fault')?.split(',').map(Number);
const recovery = opt('--around-recovery')?.split(',').map(Number);
const width = Number(opt('--width') || 960);
const score = JSON.parse(fs.readFileSync(path.join(resultsDir, 'score.json'), 'utf8'));
const { fault_start: faultStart, fault_end: faultEnd } = score.timeline;
const [from, to] = around ? [faultStart - around[0], faultStart + around[1]]
  : recovery ? [faultEnd - recovery[0], faultEnd + recovery[1]]
  : [score.timeline.normal_start, score.timeline.end];
const suffix = around ? '-fault' : recovery ? '-recovery' : '';
const outDir = path.join(resultsDir, 'panels');
fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
try {
  const page = await browser.newPage();
  // Zenn の本文幅で読める大きさ。2 倍で撮って高解像度の画面でもにじまないようにする
  await page.setViewport({ width, height: Math.round((width * 420) / 960), deviceScaleFactor: 2 });
  for (const { id, file } of PANELS.filter((p) => !only || only.includes(p.file))) {
    const url = `${GRAFANA}/d-solo/lab/lab?orgId=1&panelId=${id}&from=${from * 1000}&to=${to * 1000}&theme=dark`;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 });
    await new Promise((r) => setTimeout(r, 1500));
    // 埋め込み表示の右上に出る「Powered by Grafana」を消す
    await page.evaluate(() => {
      let badge = [...document.querySelectorAll('div')].find((e) => e.textContent?.trim() === 'Powered by');
      while (badge?.parentElement?.textContent?.trim() === 'Powered by') badge = badge.parentElement;
      if (badge) badge.style.display = 'none';
    });
    const out = path.join(outDir, `${file}${suffix}.png`);
    await page.screenshot({ path: out });
    console.log(out);
  }
} finally {
  await browser.close();
}
