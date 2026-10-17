// ?lang=en なら data-en の英語に差し替える（既定は日本語）
const lang = new URLSearchParams(location.search).get('lang') || 'ja';
document.documentElement.lang = lang;
if (lang === 'en') {
  for (const el of document.querySelectorAll('[data-en]')) el.textContent = el.dataset.en;
}

// マス目（スレッドやコネクション）を並べる：data-slots="総数" data-used="使用中" data-cols="列数"
for (const g of document.querySelectorAll('[data-slots]')) {
  const total = Number(g.dataset.slots);
  const used = Number(g.dataset.used || 0);
  const cols = Number(g.dataset.cols);
  const size = 18;
  const gap = 4;
  for (let i = 0; i < total; i++) {
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('x', (i % cols) * (size + gap));
    r.setAttribute('y', Math.floor(i / cols) * (size + gap));
    r.setAttribute('width', size);
    r.setAttribute('height', size);
    r.setAttribute('rx', 3);
    r.setAttribute('class', i < used ? 'slot used' : 'slot');
    g.appendChild(r);
  }
}
