// タイムアウトの下限と上限の図（3 枚で共通）。HTML の側で TIMEOUT_CASE を決めてから読み込む
// 帯は 2 本。上の帯は下限（下流の平常時の p99.9）より短いタイムアウト、下の帯は上限（プールの大きさ × 0.7 ÷ ピーク時の到着率）より長いタイムアウト。帯のあいだに隙間があれば、そこから選べる
const svg = document.getElementById('fig');
defs(svg);
const LX = 20, AX = 40, S = 0.5, MAX = 1400;
const X = (ms) => AX + ms * S;

const CASES = {
  threads: {
    head: tr('決済 API（平均 50ms・p99 120ms）、スレッド 40 本、到着 60 件/秒', 'Payment API (mean 50 ms, p99 120 ms), 40 threads, 60 req/s'),
    lower: 165, upper: 467, pick: 300,
  },
  connections: {
    head: tr('決済 API をトランザクションの中で呼ぶ：コネクション 10 本で計算し直す', 'Payment call inside the transaction: recomputed with 10 connections'),
    lower: 165, upper: 117, pick: 300,
  },
  slow: {
    head: tr('決済 API（平均 100ms・p99 600ms）、スレッド 40 本、到着 60 件/秒', 'Payment API (mean 100 ms, p99 600 ms), 40 threads, 60 req/s'),
    lower: 1263, upper: 467, pick: 800,
  },
};
const c = CASES[TIMEOUT_CASE];

// 凡例：帯がどのタイムアウトの値か
let y = 24;
for (const [cls, what] of [
  ['z-short', tr('下限（下流の平常時の p99.9）より短いタイムアウト', 'Timeouts below the lower bound (downstream normal p99.9)')],
  ['z-long', tr('上限（プールの大きさ × 0.7 ÷ ピーク時の到着率）より長いタイムアウト', 'Timeouts above the upper bound (pool size × 0.7 ÷ peak arrival rate)')],
]) {
  el(svg, 'rect', { class: cls, x: LX, y: y - 12, width: 28, height: 14, rx: 2 });
  text(svg, LX + 38, y, 'lbl', what);
  y += 26;
}

const TOP = y + 20, SH = 18, GAP = 6;
text(svg, LX, TOP + 14, 'hl', c.head);
const ys = TOP + 44, yl = ys + SH + GAP, END = yl + SH + 22;

for (let ms = 0; ms <= MAX; ms += 200) el(svg, 'line', { class: 'row-grid', x1: X(ms), y1: ys - 22, x2: X(ms), y2: END });

/** 帯の中に境目の値を書く。入りきらなければ外に出す */
function stripeLabel(x0, x1, ty, s, cls, side) {
  const t = el(svg, 'text', { x: 0, y: ty, class: cls }, s);
  const w = t.getComputedTextLength();
  svg.removeChild(t);
  if (x1 - x0 >= w + 16) text(svg, side === 'end' ? x1 - 8 : x0 + 8, ty, side === 'end' ? `${cls} end` : cls, s);
  else text(svg, side === 'end' ? x1 + 8 : x0 - 8, ty, side === 'end' ? cls : `${cls} end`, s);
}

el(svg, 'rect', { class: 'z-short', x: X(0), y: ys, width: X(c.lower) - X(0), height: SH });
el(svg, 'rect', { class: 'z-long', x: X(c.upper), y: yl, width: X(MAX) - X(c.upper), height: SH });
stripeLabel(X(0), X(c.lower), ys + 14, tr(`下限 ${c.lower > 1000 ? '約 1300' : c.lower}`, `lower ${c.lower > 1000 ? '~1300' : c.lower}`), 't-short', 'end');
stripeLabel(X(c.upper), X(MAX), yl + 14, tr(`上限 ${c.upper}`, `upper ${c.upper}`), 't-long', 'start');

// 実験で設定したタイムアウト。右に入りきらなければ線の左に置く
el(svg, 'line', { x1: X(c.pick), y1: ys - 8, x2: X(c.pick), y2: yl + SH + 8, stroke: '#5342a2', 'stroke-width': 3 });
const label = tr(`設定したタイムアウト ${c.pick}ms`, `timeout set to ${c.pick} ms`);
const right = text(svg, X(c.pick) + 8, ys - 10, 'small ord b', label);
if (right > 792) { svg.removeChild(svg.lastChild); text(svg, X(c.pick) - 8, ys - 10, 'small ord b end', label); }

el(svg, 'line', { class: 'axis', x1: X(0), y1: END, x2: X(MAX), y2: END });
for (let ms = 0; ms <= MAX; ms += 200) text(svg, X(ms), END + 20, 'small mid', String(ms));
text(svg, X(MAX / 2), END + 46, 'small mid', tr('タイムアウト（ms）', 'timeout (ms)'));
canvas(svg, 800, END + 60);
