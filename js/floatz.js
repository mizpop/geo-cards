// 浮かぶウィンドウ（ストリートビュー・カードや国の詳細）の共通部品: 重なり順と、画面の左右のはしへ寄せる「画面分割」
let z = 2400;
// 最後に触ったものを手前にする
export function bringFront(el) {
  if (el) el.style.zIndex = String(++z);
}

/* ---- 画面分割: ウィンドウを画面の左右のはしへドラッグして離すと、その側の半分にウィンドウ、残りの半分にアプリを並べる ---- */
const RATIO_KEY = 'geo-cards-split-ratio-v1';
const EDGE = 28; // 画面の端から何 px 以内で離したら分割するか
let ratio = (() => { try { const v = Number(localStorage.getItem(RATIO_KEY)); return v >= 0.25 && v <= 0.75 ? v : 0.5; } catch { return 0.5; } })(); // ウィンドウが占める割合
let snapped = null; // { el, side: 'left' | 'right', restore: () => void }（分割できるのは 1 つのウィンドウだけ）
let preview = null;
let bar = null;

// ヘッダー（タブの帯とデモの帯）の高さ。分割は、この下の部分だけで行う
const headerH = () => {
  const bar = document.querySelector('.topbar');
  const banner = document.getElementById('demo-banner');
  return Math.round((bar?.offsetHeight || 0) + (banner && !banner.hidden ? banner.offsetHeight : 0));
};
export const snapSideAt = (x) => (x <= EDGE ? 'left' : x >= window.innerWidth - EDGE ? 'right' : null);
export const isSnapped = (el) => snapped?.el === el;
const resized = () => setTimeout(() => window.dispatchEvent(new Event('resize')), 0); // 地図などに大きさの変化を知らせる

// ドラッグ中に、離したらどこに入るかを薄く見せる（side が null なら消す）
export function showSnapPreview(side) {
  if (!side) { preview?.remove(); preview = null; return; }
  if (!preview) {
    preview = document.createElement('div');
    preview.className = 'snap-preview';
    document.body.appendChild(preview);
  }
  const top = headerH();
  preview.style.left = side === 'left' ? '0' : `${(1 - ratio) * 100}vw`;
  preview.style.width = `${ratio * 100}vw`;
  preview.style.top = `${top}px`;
  preview.style.height = `calc(100vh - ${top}px)`;
}

function placeBar() {
  if (!snapped) return;
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'split-bar';
    bar.title = 'ドラッグで分割の幅を変える';
    bar.setAttribute('role', 'separator');
    bar.setAttribute('aria-orientation', 'vertical');
    document.body.appendChild(bar);
    let drag = false;
    bar.addEventListener('pointerdown', (e) => { drag = true; bar.setPointerCapture(e.pointerId); e.preventDefault(); });
    bar.addEventListener('pointermove', (e) => {
      if (!drag || !snapped) return;
      const x = e.clientX / window.innerWidth;
      ratio = Math.max(0.25, Math.min(0.75, snapped.side === 'left' ? x : 1 - x));
      layout();
    });
    const end = () => { if (drag) { drag = false; try { localStorage.setItem(RATIO_KEY, String(ratio)); } catch { /* 無視 */ } } };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
  }
  const edge = snapped.side === 'left' ? ratio * 100 : (1 - ratio) * 100; // ウィンドウとアプリの境目
  const top = headerH();
  bar.style.left = `calc(${edge}vw - 5px)`;
  bar.style.top = `${top}px`;
  bar.style.height = `calc(100vh - ${top}px)`;
  bar.style.zIndex = String(z + 5);
}

function layout(silent = false) {
  if (!snapped) return;
  const { el, side } = snapped;
  document.body.dataset.split = side;
  document.documentElement.style.setProperty('--split', String(ratio));
  const top = headerH();
  el.classList.add('is-snap');
  el.classList.remove('is-max', 'is-min');
  Object.assign(el.style, {
    position: 'fixed', margin: '0', top: `${top}px`, bottom: 'auto', right: 'auto', maxHeight: 'none',
    height: `calc(100vh - ${top}px)`, width: `${ratio * 100}vw`, left: side === 'left' ? '0' : `${(1 - ratio) * 100}vw`,
  });
  placeBar();
  if (!silent) resized();
}

function clearBody() {
  delete document.body.dataset.split;
  document.documentElement.style.removeProperty('--split');
  bar?.remove();
  bar = null;
  resized();
}

// ウィンドウを side の半分に入れる。restore: 浮かぶ状態に戻すとき（ドラッグで外したとき・縮小・拡大）に呼ぶ関数
export function snapWindow(el, side, restore) {
  if (snapped && snapped.el !== el) unsnapWindow(snapped.el); // 先に別のウィンドウが入っていたら、浮かぶ状態に戻す
  snapped = { el, side, restore };
  showSnapPreview(null);
  layout();
}
// 分割をやめて、浮かぶ状態に戻す。戻したら true
export function unsnapWindow(el) {
  if (!snapped || snapped.el !== el) return false;
  const { restore } = snapped;
  snapped = null;
  el.classList.remove('is-snap');
  clearBody();
  restore?.();
  return true;
}
// ウィンドウを閉じたとき（元に戻す処理はしない）
export function releaseSnap(el) {
  if (snapped?.el !== el) return;
  snapped = null;
  el.classList.remove('is-snap');
  clearBody();
}

// ヘッダーの高さが変わったとき（帯が出入りしたなど）は、ウィンドウの位置を合わせ直す
if ('ResizeObserver' in window) {
  const watch = () => { const bar = document.querySelector('.topbar'); if (bar) new ResizeObserver(() => layout(true)).observe(bar); else setTimeout(watch, 500); };
  watch();
}
