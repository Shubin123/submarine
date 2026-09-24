// Shared page chrome, colormaps, field rendering and a small SVG line chart.

const PAGES = [
  ['index.html', 'Overview'],
  ['demos/cavity.html', 'FVM vs LBM cavity'],
  ['demos/cylinder.html', 'Cylinder wake'],
  ['demos/units.html', 'Lattice units'],
  ['demos/vehicle.html', 'Vehicle + Gazebo'],
  ['research.html', 'Research note'],
];

export function chrome(root = '.') {
  const here = location.pathname.split('/').slice(-2).join('/');
  const header = document.createElement('header');
  header.className = 'site';
  const nav = document.createElement('nav');
  PAGES.forEach(([href, label], i) => {
    const a = document.createElement('a');
    a.href = `${root}/${href}`;
    a.textContent = i === 0 ? 'Submarine CFD' : label;
    if (i === 0) a.className = 'brand';
    if (here.endsWith(href) || (i === 0 && /\/(index\.html)?$/.test(location.pathname) && !here.includes('demos/'))) a.setAttribute('aria-current', 'page');
    nav.append(a);
  });
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.title = 'Toggle light/dark theme';
  const html = document.documentElement;
  const saved = (() => { try { return localStorage.getItem('theme'); } catch { return null; } })();
  if (saved) html.dataset.theme = saved;
  const isDark = () => html.dataset.theme ? html.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const label = () => { btn.textContent = isDark() ? '☀ Light' : '☾ Dark'; };
  btn.onclick = () => {
    html.dataset.theme = isDark() ? 'light' : 'dark';
    try { localStorage.setItem('theme', html.dataset.theme); } catch {}
    label();
    dispatchEvent(new Event('themechange'));
  };
  label();
  nav.append(btn);
  header.append(nav);
  document.body.prepend(header);
}

export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Colormaps: sequential blue (magnitude) and diverging blue–gray–red (signed).
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const SEQ = ['#f4f8fe', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'].map(hex);
const DIV = ['#0d366b', '#256abf', '#6da7ec', '#b7d3f6', '#f0efec', '#f6c3c2', '#ec8a89', '#e34948', '#a52524'].map(hex);

function ramp(stops, n = 256) {
  const lut = new Uint8ClampedArray(n * 3);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (stops.length - 1);
    const k = Math.min(Math.floor(t), stops.length - 2), f = t - k;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = stops[k][c] + f * (stops[k + 1][c] - stops[k][c]);
  }
  return lut;
}
export const LUT = { sequential: ramp(SEQ), diverging: ramp(DIV) };
export const rampCss = (name) =>
  `linear-gradient(90deg, ${(name === 'diverging' ? DIV : SEQ).map((c) => `rgb(${c.join(',')})`).join(',')})`;

// Draw a scalar field (row-major, y = 0 at the bottom) into a canvas.
export function drawField(canvas, field, nx, ny, { lut = LUT.sequential, min = 0, max = 1, solid = null, solidColor = [120, 120, 115] } = {}) {
  if (canvas.width !== nx || canvas.height !== ny) { canvas.width = nx; canvas.height = ny; }
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(nx, ny);
  const d = img.data, span = max - min || 1;
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      const i = y * nx + x, o = ((ny - 1 - y) * nx + x) * 4;
      if (solid && solid[i]) { d[o] = solidColor[0]; d[o + 1] = solidColor[1]; d[o + 2] = solidColor[2]; d[o + 3] = 255; continue; }
      let t = (field[i] - min) / span;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const k = Math.round(t * 255) * 3;
      d[o] = lut[k]; d[o + 1] = lut[k + 1]; d[o + 2] = lut[k + 2]; d[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
}

// Line chart. series: [{ name, color (css var), points: [[x, y], ...], dashed, markers }].
export function lineChart(container, { series, xLabel = '', yLabel = '', xDomain, yDomain, width = 520, height = 300, fmt = (v) => v.toFixed(3), band }) {
  const m = { l: 52, r: 16, t: 12, b: 40 };
  const all = series.flatMap((s) => s.points);
  const ext = (i) => [Math.min(...all.map((p) => p[i])), Math.max(...all.map((p) => p[i]))];
  const [x0, x1] = xDomain ?? ext(0);
  let [y0, y1] = yDomain ?? ext(1);
  if (band && !yDomain) { y0 = Math.min(y0, band[0]); y1 = Math.max(y1, band[1]); } // keep the reference band in view
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const sx = (x) => m.l + ((x - x0) / (x1 - x0 || 1)) * (width - m.l - m.r);
  const sy = (y) => height - m.b - ((y - y0) / (y1 - y0)) * (height - m.t - m.b);
  const ticks = (a, b, n = 5) => {
    const step = 10 ** Math.floor(Math.log10((b - a) / n));
    const err = (b - a) / n / step;
    const s = step * (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1);
    const out = [];
    for (let v = Math.ceil(a / s) * s; v <= b + 1e-9; v += s) out.push(+v.toFixed(10));
    return out;
  };
  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent?.append(e);
    return e;
  };
  container.classList.add('chart');
  container.innerHTML = '';
  const legend = document.createElement('div');
  legend.className = 'legend';
  if (series.length > 1)
    for (const s of series) {
      const sp = document.createElement('span');
      sp.style.setProperty('--c', `var(${s.color})`);
      if (s.markers && !s.line) sp.className = 'dot';
      sp.textContent = s.name;
      legend.append(sp);
    }
  container.append(legend);
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${yLabel} vs ${xLabel}` }, container);
  const axisColor = 'var(--muted)';
  if (band) el('rect', { x: m.l, width: width - m.l - m.r, y: sy(band[1]), height: Math.max(1, sy(band[0]) - sy(band[1])), fill: 'var(--series-2)', opacity: 0.12 }, svg);
  for (const t of ticks(y0, y1)) {
    el('line', { x1: m.l, x2: width - m.r, y1: sy(t), y2: sy(t), stroke: 'var(--grid)' }, svg);
    el('text', { x: m.l - 6, y: sy(t) + 4, 'text-anchor': 'end', 'font-size': 11, fill: axisColor }, svg).textContent = +t.toPrecision(4);
  }
  for (const t of ticks(x0, x1)) el('text', { x: sx(t), y: height - m.b + 16, 'text-anchor': 'middle', 'font-size': 11, fill: axisColor }, svg).textContent = +t.toPrecision(4);
  el('line', { x1: m.l, x2: width - m.r, y1: height - m.b, y2: height - m.b, stroke: 'var(--border)' }, svg);
  el('text', { x: (m.l + width - m.r) / 2, y: height - 6, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--text-2)' }, svg).textContent = xLabel;
  el('text', { x: 14, y: (m.t + height - m.b) / 2, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--text-2)', transform: `rotate(-90 14 ${(m.t + height - m.b) / 2})` }, svg).textContent = yLabel;
  for (const s of series) {
    const c = `var(${s.color})`;
    if (s.line !== false && s.points.length > 1)
      el('path', { d: s.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(''), fill: 'none', stroke: c, 'stroke-width': 2, 'stroke-dasharray': s.dashed ? '5 4' : '', 'stroke-linejoin': 'round' }, svg);
    if (s.markers) for (const p of s.points) el('circle', { cx: sx(p[0]), cy: sy(p[1]), r: 4, fill: c, stroke: 'var(--surface)', 'stroke-width': 2 }, svg);
  }
  // Hover: crosshair + nearest value per series.
  const cross = el('line', { y1: m.t, y2: height - m.b, stroke: 'var(--muted)', 'stroke-dasharray': '3 3', visibility: 'hidden' }, svg);
  const tip = document.createElement('div');
  tip.className = 'tip';
  container.append(tip);
  const hit = el('rect', { x: m.l, y: m.t, width: width - m.l - m.r, height: height - m.t - m.b, fill: 'transparent' }, svg);
  hit.addEventListener('pointermove', (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * width;
    const x = x0 + ((px - m.l) / (width - m.l - m.r)) * (x1 - x0);
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
    const rows = series.map((s) => {
      let best = s.points[0];
      for (const p of s.points) if (Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p;
      return `<div><b style="color:var(${s.color})">●</b> ${s.name}: ${fmt(best[1])} <span style="color:var(--muted)">@ ${+best[0].toPrecision(4)}</span></div>`;
    });
    tip.innerHTML = rows.join('');
    tip.style.display = 'block';
    const left = ev.clientX - container.getBoundingClientRect().left;
    tip.style.left = `${Math.min(left + 12, container.clientWidth - tip.offsetWidth - 4)}px`;
    tip.style.top = `${ev.clientY - container.getBoundingClientRect().top + 12}px`;
  });
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; });
}

// Tabular fallback for a chart's series.
export function seriesTable(container, series, xName, yName) {
  const rows = [];
  for (const s of series) for (const p of s.points) rows.push(`<tr><td>${s.name}</td><td>${+p[0].toPrecision(5)}</td><td>${+p[1].toPrecision(5)}</td></tr>`);
  container.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Series</th><th>${xName}</th><th>${yName}</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

export function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
