// ウィンドウを「しまう場所」: ウィンドウを左下の角までドラッグして離すと、ウィンドウはバックグラウンドで保持される。
// その角にポインターを合わせると、しまったウィンドウが、トランプのカードのように画面の下に横に広がり、取り出せる（押すと元の位置に戻る。✕ で閉じる）
import { bringFront } from './floatz.js';

const items = new Map(); // key → { key, label(), thumb(), restore(rect), close() }
let root = null;
let fan = null;
let stack = null;
let hot = null;
let openTimer = null;
let closeTimer = null;
let isOpen = false;

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function build() {
  if (root) return;
  root = document.createElement('div');
  root.id = 'win-dock';
  root.innerHTML = '<div class="dock-hot" aria-hidden="true"></div><div class="dock-stack" hidden></div><div class="dock-fan"></div>';
  document.body.appendChild(root);
  hot = root.querySelector('.dock-hot');
  stack = root.querySelector('.dock-stack');
  fan = root.querySelector('.dock-fan');
  const enter = () => { clearTimeout(closeTimer); if (items.size && !isOpen) { clearTimeout(openTimer); openTimer = setTimeout(openFan, 90); } };
  const leave = () => { clearTimeout(openTimer); clearTimeout(closeTimer); closeTimer = setTimeout(closeFan, 380); };
  hot.addEventListener('mouseenter', enter);
  stack.addEventListener('mouseenter', enter);
  fan.addEventListener('mouseover', (e) => { if (e.target.closest('.dock-card')) { clearTimeout(closeTimer); } });
  fan.addEventListener('mouseleave', leave);
  hot.addEventListener('mouseleave', leave);
  stack.addEventListener('mouseleave', leave);
  fan.addEventListener('click', (e) => {
    const x = e.target.closest('.dock-x');
    const card = e.target.closest('.dock-card');
    if (!card) return;
    const it = items.get(card._key);
    if (!it) return;
    if (x) { e.stopPropagation(); it.close(); return; }
    const rect = card.getBoundingClientRect();
    closeFan(true);
    it.restore({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  });
  window.addEventListener('resize', layout);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) closeFan(); });
}

// トランプのカードのように、横に少し重ねて、扇のように広げる
function layout() {
  if (!fan) return;
  const n = items.size;
  const W = 150;
  const avail = Math.max(0, window.innerWidth - 48 - W);
  const step = n > 1 ? Math.min(W + 14, avail / (n - 1)) : 0;
  [...fan.children].forEach((c, i) => {
    c.style.setProperty('--x', `${Math.round(24 + i * step)}px`);
    c.style.setProperty('--rot', `${((i - (n - 1) / 2) * Math.min(4, 22 / Math.max(1, n))).toFixed(2)}deg`);
    c.style.setProperty('--i', String(i));
    c.style.zIndex = String(i + 1);
  });
}
function openFan() {
  if (!items.size) return;
  isOpen = true;
  root.classList.add('is-open');
  bringFront(root);
  layout();
}
function closeFan() { isOpen = false; root?.classList.remove('is-open'); }

function render() {
  build();
  fan.innerHTML = '';
  for (const it of items.values()) {
    const c = document.createElement('div');
    c.className = 'dock-card';
    c._key = it.key;
    const thumb = it.thumb?.() || {};
    c.innerHTML = `<button type="button" class="dock-x" aria-label="閉じる" title="このウィンドウを閉じる">✕</button>
      <div class="dock-thumb">${thumb.src ? `<img src="${esc(thumb.src)}" alt="">` : `<span class="dock-emoji">${esc(thumb.emoji || '🗂')}</span>`}</div>
      <div class="dock-label">${esc(it.label?.() || '')}</div>`;
    if (thumb.style) c.setAttribute('style', thumb.style);
    fan.appendChild(c);
  }
  layout();
  // 角のしるし（しまったウィンドウがあるときだけ）: 重なったカードと、枚数
  stack.hidden = items.size === 0;
  stack.innerHTML = items.size ? `<span class="dock-mini m3"></span><span class="dock-mini m2"></span><span class="dock-mini m1">🗂</span><b class="dock-count">${items.size}</b>` : '';
  if (!items.size) closeFan();
}

/** ウィンドウをしまう。item: { key, label(), thumb() → { src | emoji, style }, restore(rect), close() } */
export function dockAdd(item) {
  items.set(item.key, item);
  render();
}
export function dockRemove(key) {
  if (items.delete(key)) render();
}
export const dockHas = (key) => items.has(key);
export function dockRefresh() { if (items.size) render(); }
