// 答えの表示で、ストリートビューを「地図の上の吹き出し」として開閉する（初めは閉じている）
// 開いているかどうかは、問題をまたいで覚えておく
let open = false;
export const isSvBubbleOpen = () => open;
// cardEl: ストリートビューの問題カード、mapEl: 地図の入れ物（この中に吹き出しを置く）、btn: 開閉ボタン（なくてもよい）
export function placeSvBubble(cardEl, mapEl, btn) {
  if (!cardEl || !mapEl) return null;
  mapEl.querySelector(':scope > .sv-bubble')?.remove();
  const bubble = document.createElement('div');
  bubble.className = 'sv-bubble';
  bubble.innerHTML = '<div class="sv-bubble-inner"></div><div class="sv-bubble-tail"></div><button type="button" class="sv-bubble-x" aria-label="ストリートビューを閉じる">✕</button>';
  bubble.querySelector('.sv-bubble-inner').append(cardEl);
  mapEl.append(bubble);
  for (const ev of ['click', 'dblclick', 'mousedown', 'wheel', 'pointerdown', 'touchstart']) bubble.addEventListener(ev, (e) => e.stopPropagation()); // 下の地図を動かさない
  const sync = () => {
    bubble.hidden = !open;
    if (btn) btn.textContent = `🧍 ストリートビューを${open ? '閉じる' : '開く'}`;
  };
  const toggle = () => { open = !open; sync(); };
  btn?.addEventListener('click', toggle);
  bubble.querySelector('.sv-bubble-x').addEventListener('click', toggle);
  sync();
  return { toggle };
}
