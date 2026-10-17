// 解説図の共通の部品。?lang=en なら英語で描く（既定は日本語）
const LANG = new URLSearchParams(location.search).get('lang') || 'ja';
document.documentElement.lang = LANG;
const NS = 'http://www.w3.org/2000/svg';

/** 日本語と英語のうち、描く言語の方を返す */
const tr = (ja, en) => (LANG === 'en' ? en : ja);

/** svg の要素を作って親に足す。text を渡すと文字を入れる */
function el(parent, tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

/** 文字を置いて、その右端の x を返す */
function text(parent, x, y, cls, s) {
  const t = el(parent, 'text', { x, y, class: cls }, s);
  return x + t.getComputedTextLength();
}

/** 矢印と斜線の定義 */
function defs(svg) {
  const d = el(svg, 'defs');
  for (const [id, color] of [['arrow', '#6e6e73'], ['arrow-bad', '#c03a33']]) {
    const m = el(d, 'marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' });
    el(m, 'path', { d: 'M0 0L10 5L0 10z', fill: color });
  }
  const p = el(d, 'pattern', { id: 'hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  el(p, 'rect', { width: 6, height: 6, fill: '#fdf0ef' });
  el(p, 'line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: '#e08a84', 'stroke-width': 2 });
}

/** 図の大きさを決めて、白地を敷く */
function canvas(svg, w, h) {
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', w);
  bg.setAttribute('height', h);
  bg.setAttribute('fill', '#ffffff');
  svg.insertBefore(bg, svg.firstChild);
}
