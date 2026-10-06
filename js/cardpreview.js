// カードのプレビュー（PC のみ）: 関連カードのボタンなど、カードを指している部分にポインターを合わせると、そのカードを小さく表示する。
// 対象: [data-related]（カードの中の関連カード）、[data-card-open]（ストリートビュータブの、保存した場所の関連カード）
const SEL = '[data-related], [data-card-open]';
const DELAY = 280; // 合わせてから出るまで（ちらつかないように）
let deps = null;
let box = null;
let timer = null;
let current = null;

const canHover = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

function hide() {
  clearTimeout(timer); timer = null; current = null;
  if (box) { box.remove(); box = null; }
}

function show(el, id) {
  const card = deps.cardById(id);
  if (!card) return;
  const { esc } = deps;
  const img = deps.imgUrl(card) || deps.thumbUrl(card);
  const notes = (card.notes || '').replace(/\s+/g, ' ').trim();
  box = document.createElement('div');
  box.id = 'card-preview';
  box.setAttribute('role', 'tooltip');
  box.setAttribute('style', deps.catStyle(card));
  box.innerHTML = `
    <div class="cp-img">${deps.catBadge(card, 'cat-on-img')}${img ? `<img src="${esc(img)}" alt="">` : ''}</div>
    <div class="cp-body">
      <div class="cp-countries">${card.countries.slice(0, 3).map((c) => `<span class="chip">${deps.flagImg(c)}${esc(deps.countryName(c))}</span>`).join('')}${card.countries.length > 3 ? `<span class="chip chip-more">+${card.countries.length - 3}</span>` : ''}</div>
      ${card.description ? `<p class="cp-desc">${esc(card.description)}</p>` : ''}
      ${notes ? `<p class="cp-notes">${esc(notes.length > 90 ? `${notes.slice(0, 90)}…` : notes)}</p>` : ''}
    </div>`;
  document.body.appendChild(box);
  // 要素の右（入りきらなければ左）・下（入りきらなければ上）に、画面からはみ出さないように置く
  const r = el.getBoundingClientRect();
  const w = box.offsetWidth;
  const h = box.offsetHeight;
  const left = r.right + 10 + w <= window.innerWidth - 8 ? r.right + 10 : Math.max(8, r.left - w - 10);
  const top = Math.max(8, Math.min(window.innerHeight - h - 8, r.top + r.height / 2 - h / 2));
  Object.assign(box.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
}

/** deps: { cardById, imgUrl, thumbUrl, catStyle, catBadge, flagImg, countryName, esc } */
export function initCardPreview(d) {
  deps = d;
  document.addEventListener('mouseover', (e) => {
    if (!canHover()) return;
    const el = e.target.closest?.(SEL);
    if (!el) { if (current && !e.target.closest?.('#card-preview')) hide(); return; }
    const id = el.dataset.related || el.dataset.cardOpen;
    if (!id || current === el) return;
    hide();
    current = el;
    timer = setTimeout(() => { if (current === el && document.contains(el)) show(el, id); }, DELAY);
  });
  document.addEventListener('mouseout', (e) => {
    const el = e.target.closest?.(SEL);
    if (el && el === current && !el.contains(e.relatedTarget)) hide();
  });
  // クリック・スクロール・Esc・ウィンドウの移動で消す
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('wheel', hide, { passive: true, capture: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); }, true);
  window.addEventListener('blur', hide);
}
