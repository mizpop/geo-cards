// 地図で、国・地域にカーソルを乗せたときの小さな吹き出し（旗 + 名前 + ひとこと）。世界モードの地図（js/map.js）と同じ見た目で、カーソルの右下に出る。
export function createHoverBubble(host = document.body) {
  const b = document.createElement('div');
  b.className = 'hover-bubble is-compact';
  b.setAttribute('aria-hidden', 'true');
  host.appendChild(b);
  const mouse = { x: 0, y: 0 };
  const place = () => {
    const w = b.offsetWidth; const h = b.offsetHeight;
    let x = mouse.x + 16; let y = mouse.y + 18;
    if (x + w > window.innerWidth - 8) x = mouse.x - w - 12;
    if (y < 8) y = 8;
    if (y + h > window.innerHeight - 8) y = Math.max(8, mouse.y - h - 12);
    b.style.transform = `translate(${Math.max(8, x)}px, ${y}px)`;
  };
  const onMove = (e) => { mouse.x = e.clientX; mouse.y = e.clientY; if (b.classList.contains('show')) place(); };
  document.addEventListener('mousemove', onMove, { passive: true, capture: true });
  return {
    /** html: 吹き出しの中身（.hb-body の中）。ev: マウスのイベント（位置の初期値） */
    show(html, ev) {
      const oe = ev?.originalEvent || ev;
      if (oe?.clientX != null) { mouse.x = oe.clientX; mouse.y = oe.clientY; }
      b.className = 'hover-bubble is-compact show';
      b.innerHTML = `<div class="hb-body hb-compact">${html}</div>`;
      place();
    },
    hide() { b.classList.remove('show'); },
    destroy() { document.removeEventListener('mousemove', onMove, { capture: true }); b.remove(); },
  };
}
