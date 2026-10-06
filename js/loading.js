// 読み込み中のアニメーション: ①画面の上の細い進行バー（通信中）②画像が読み込まれるまでの、きらっと光る下地 ③起動中の表示
const slowRe = /\/api\/ask|fonts\.g|tile\.|\.tile\b|openstreetmap|arcgisonline|cartocdn|googleapis\.com\/maps|\/realtime\//; // 長く続く通信・地図のタイルは、進行バーに数えない

export function initLoading() {
  // ---- ①通信中の進行バー（すぐ終わる通信では出さない: 0.15 秒たってから）
  const bar = document.createElement('div');
  bar.id = 'top-loader';
  bar.innerHTML = '<i></i>';
  document.body.appendChild(bar);
  let pending = 0;
  let showTimer = null;
  const update = () => {
    if (pending > 0) {
      if (!showTimer && !bar.classList.contains('on')) showTimer = setTimeout(() => { showTimer = null; if (pending > 0) bar.classList.add('on'); }, 150);
    } else {
      clearTimeout(showTimer); showTimer = null;
      bar.classList.remove('on');
    }
  };
  const origFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (slowRe.test(url) || init?.method === 'HEAD') return origFetch(input, init);
    pending++; update();
    const done = () => { pending = Math.max(0, pending - 1); update(); };
    return origFetch(input, init).then((r) => { done(); return r; }, (e) => { done(); throw e; });
  };

  // ---- ②画像: 読み込み中は光る下地、読み込めたらふわっと表示
  const watch = (img) => {
    if (img.__ld) return;
    img.__ld = true;
    if (img.complete && img.naturalWidth) return; // すでに読み込み済み（保存済み・data: など）
    img.classList.add('img-loading');
    const end = (ok) => { img.classList.remove('img-loading'); if (ok) { img.classList.add('img-loaded'); setTimeout(() => img.classList.remove('img-loaded'), 400); } };
    img.addEventListener('load', () => end(true), { once: true });
    img.addEventListener('error', () => end(false), { once: true });
  };
  const scan = (root) => {
    if (root.nodeType !== 1) return;
    if (root.tagName === 'IMG') watch(root);
    root.querySelectorAll?.('img').forEach(watch);
  };
  new MutationObserver((list) => {
    for (const m of list) {
      m.addedNodes.forEach(scan);
      if (m.type === 'attributes' && m.target.tagName === 'IMG') { m.target.__ld = false; m.target.classList.remove('img-loading'); watch(m.target); } // src が変わったとき
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  scan(document.body);

  // ---- ③起動中の表示: ログイン画面かアプリが出たら消す
  const boot = document.getElementById('boot');
  if (boot) {
    const hide = () => {
      if (document.getElementById('login')?.hidden === false || document.getElementById('app')?.hidden === false) {
        boot.classList.add('gone');
        setTimeout(() => boot.remove(), 400);
        return true;
      }
      return false;
    };
    if (!hide()) {
      const mo = new MutationObserver(() => { if (hide()) mo.disconnect(); });
      for (const id of ['login', 'app']) { const e = document.getElementById(id); if (e) mo.observe(e, { attributes: true, attributeFilter: ['hidden'] }); }
      setTimeout(() => { boot.classList.add('gone'); mo.disconnect(); }, 8000); // 念のため
    }
  }
}
