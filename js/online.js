// 今、GeoChecker を開いている人の数（ログインしている人）を、上のバーに出す
// Supabase Realtime の Presence（対戦の通信と同じ仕組み。テーブルは使わない）。5 分以上、操作がない人は「離席中」
const ROOM = '__online'; // 対戦の部屋のコード（5 文字）と、かぶらない名前
const IDLE_MS = 5 * 60 * 1000;
const NAME_KEY = 'geo-cards-battle-name';
const newId = () => Math.random().toString(36).slice(2, 10);

let ch = null;
let timer = null;
let pop = null;
let people = []; // いま見えている接続（1 つのタブ・ウィンドウ = 1 件）
let stopFns = [];

/** deps: { api, user, esc, btn: 上のバーのボタン } */
export async function startOnline(deps) {
  const { api, user, btn, esc } = deps;
  if (ch || !api.battleChannel || !user || !btn) return;
  const me = { id: newId(), uid: String(user.email || user.id || ''), name: '', away: false, at: Date.now() };
  const readName = () => { try { return (localStorage.getItem(NAME_KEY) || '').slice(0, 16); } catch { return ''; } };
  me.name = readName();
  let last = Date.now();
  let away = false;
  const info = () => ({ ...me, name: readName(), away });

  // 同じ人（メールが同じ）が、複数のタブ・ウィンドウで開いていても、1 人と数える。1 つでも操作されていれば、離席ではない
  const users = () => {
    const m = new Map();
    for (const p of people) {
      const k = p.uid || p.id;
      const u = m.get(k) || { key: k, name: '', away: true, mine: false, n: 0 };
      u.n++;
      if (!p.away) u.away = false;
      if (p.name && !u.name) u.name = p.name;
      if (p.id === me.id || k === me.uid) u.mine = true;
      m.set(k, u);
    }
    return [...m.values()].sort((a, b) => (a.away - b.away) || (b.mine - a.mine) || a.name.localeCompare(b.name, 'ja'));
  };
  const paint = () => {
    const list = users();
    const active = list.filter((u) => !u.away).length;
    const idle = list.length - active;
    btn.hidden = false;
    btn.innerHTML = `<span aria-hidden="true">👥</span><b class="on-n">${active}</b>${idle ? `<span class="on-away">+${idle}</span>` : ''}`;
    btn.title = `今、GeoChecker を開いている人: ${list.length} 人（操作中 ${active} 人・離席中 ${idle} 人。5 分以上操作がないと、離席中）`;
    btn.setAttribute('aria-label', btn.title);
    if (pop?.isConnected) drawPop(list);
  };
  const drawPop = (list = users()) => {
    pop.innerHTML = `<div class="on-head"><b>いま開いている人</b><span class="muted small">${list.length} 人</span></div>
      <ul class="on-list">${list.map((u) => `<li class="${u.away ? 'is-away' : ''}"><span class="on-dot" aria-hidden="true">${u.away ? '🌙' : '🟢'}</span><span class="on-name">${esc(u.name || 'ユーザー')}${u.mine ? ' <em>（あなた）</em>' : ''}</span><span class="muted small">${u.away ? '離席中' : '操作中'}</span></li>`).join('') || '<li class="muted small">だれも見つかりません</li>'}</ul>
      <p class="muted small on-note">5 分以上、操作がないと、離席中になります。名前は、対戦で入力した名前です（未入力なら「ユーザー」）</p>`;
  };
  const closePop = () => { pop?.remove(); pop = null; document.removeEventListener('pointerdown', outside, true); };
  const outside = (e) => { if (pop && !pop.contains(e.target) && !btn.contains(e.target)) closePop(); };
  const onBtn = () => {
    if (pop) { closePop(); return; }
    pop = document.createElement('div');
    pop.className = 'on-pop';
    document.body.appendChild(pop);
    drawPop();
    const r = btn.getBoundingClientRect();
    pop.style.top = `${Math.round(r.bottom + 6)}px`;
    pop.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
    document.addEventListener('pointerdown', outside, true);
  };
  btn.addEventListener('click', onBtn);

  try {
    ch = await api.battleChannel(ROOM, info(), { msg: () => {}, presence: (list) => { people = list; paint(); } });
  } catch { ch = null; return; }

  // 操作: マウス・キー・タッチ・スクロール。操作があれば、すぐ「操作中」に戻す
  const touch = () => { last = Date.now(); if (away) { away = false; ch?.setMe(info()); } };
  const evs = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'];
  for (const ev of evs) window.addEventListener(ev, touch, { capture: true, passive: true });
  timer = setInterval(() => { // 離席の判定（10 秒ごと）。名前を変えたときも反映する
    const now = Date.now() - last > IDLE_MS;
    if (now !== away) { away = now; ch?.setMe(info()); } else if (readName() !== (people.find((p) => p.id === me.id)?.name || '')) ch?.setMe(info());
  }, 10000);
  stopFns = [() => { for (const ev of evs) window.removeEventListener(ev, touch, { capture: true }); }, () => btn.removeEventListener('click', onBtn), closePop];
  paint();
}

export function stopOnline(btn) {
  clearInterval(timer); timer = null;
  stopFns.forEach((f) => { try { f(); } catch { /* 無視 */ } }); stopFns = [];
  try { ch?.leave(); } catch { /* 無視 */ }
  ch = null; people = [];
  if (btn) btn.hidden = true;
}
