// クイズのリアルタイム対戦（部屋のコードで集まり、同じ問題を同時に解いて得点を競う）
// 出題内容: カード / 参考写真 / 国の特徴 / ストリートビュー。回答方式: 4 択・入力・地図・ピン（出題内容によって使えるもの）
// 通信は Supabase Realtime の Broadcast / Presence（テーブルは使わない）。デモモードでは同じブラウザの別タブどうしで試せる
// ホストが問題を出す合図（q）と答え合わせ（reveal）を送り、得点は各自が出して（ans）全員で足し合わせる
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 5 }, () => ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)]).join('');
const newId = () => Math.random().toString(36).slice(2, 10);
const NAME_KEY = 'geo-cards-battle-name';
const SCOPE_KEY = 'geo-cards-battle-scope-v1';
const medal = (i) => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
const KINDS = [['cards', '🃏 カード'], ['photo', '📷 参考写真'], ['fact', '🗺 国の特徴'], ['sv', '🧍 ストリートビュー']];
const MODES = { choice: '4 択', input: '入力', map: '地図で選ぶ', pin: '場所をピン' };
const modesOf = (kind) => (kind === 'cards' ? ['choice', 'input', 'map'] : kind === 'fact' ? ['choice'] : ['choice', 'input', 'map', 'pin']);
const bonus = (ms, limit) => 1 - Math.min(1, ms / (limit * 1000)); // 速いほど 1 に近い

// 公開中の部屋（アプリ全体で共有。ポップアップと、対戦の入口の一覧の両方が使う）
const roomsStore = new Map(); // コード → { name, n, max, kind, seen, popped, dismissed }
const roomListeners = new Set();
const FRESH_MS = 25000;
export const publicRooms = () => [...roomsStore].filter(([, r]) => r.n < r.max && Date.now() - r.seen < FRESH_MS).map(([code, r]) => ({ code, ...r }));
const notifyRooms = () => roomListeners.forEach((f) => f());

export function mountBattle(host, ctx) {
  const { api, esc, play, toast, countryName, flagImg, cardById, frontHtml, onExit } = ctx;
  const me = { id: newId(), name: '' };
  try { me.name = localStorage.getItem(NAME_KEY) || ''; } catch { /* 無視 */ }
  let ch = null;
  let room = '';
  let isHost = false;
  let phase = 'entry'; // entry → lobby → play → reveal → final
  let players = new Map(); // id → { id, name, host }（今つながっている人）
  const names = new Map(); // id → 名前
  let game = null;
  let tick = null;
  let timers = [];
  let building = false;
  const cfg = { kind: 'cards', mode: 'choice', topic: 'chevron', svSource: 'random', qn: 10, perQ: 20, max: 8, autoNext: 0, public: false, regions: new Set(ctx.regions.map((r) => r.id)), catsOff: new Set(), photoTopics: new Set(ctx.photoTopics.map((t) => t.id)) };
  try { const sv = JSON.parse(localStorage.getItem(SCOPE_KEY) || 'null'); if (sv) { cfg.regions = new Set(sv.regions.filter((r) => ctx.regions.some((x) => x.id === r))); cfg.catsOff = new Set(sv.catsOff || []); cfg.photoTopics = new Set(sv.photoTopics || [...cfg.photoTopics]); } } catch { /* 無視 */ }
  const saveScope = () => { try { localStorage.setItem(SCOPE_KEY, JSON.stringify({ regions: [...cfg.regions], catsOff: [...cfg.catsOff], photoTopics: [...cfg.photoTopics] })); } catch { /* 無視 */ } };
  let hostId = '';
  const alive = () => host.isConnected;
  host.innerHTML = '<div id="bt-main"></div><aside class="bt-chat" id="bt-chat" hidden></aside>';
  const main = host.querySelector('#bt-main');
  const chat = host.querySelector('#bt-chat');
  const chatLog = []; // { name, text, mine, sys }
  let chatOpen = false;
  let unread = 0;
  const clearHostTimers = () => { timers.forEach(clearTimeout); timers = []; };
  const clearTimers = () => { clearInterval(tick); tick = null; clearHostTimers(); };
  const later = (ms, fn) => { timers.push(setTimeout(() => { if (alive()) fn(); }, ms)); };
  function leave() { cfg.public = false; if (pubTimer) stopPublic(); clearTimers(); chat.hidden = true; ctx.setSvHide(false); try { ch?.leave(); } catch { /* 無視 */ } ch = null; }
  const send = (m) => ch?.send(m);

  async function join(code, asHost) {
    me.name = (host.querySelector('#bt-name')?.value || me.name || '').trim().slice(0, 16) || `プレイヤー${Math.floor(Math.random() * 90 + 10)}`;
    try { localStorage.setItem(NAME_KEY, me.name); } catch { /* 無視 */ }
    room = code;
    isHost = asHost;
    hostId = asHost ? me.id : '';
    names.set(me.id, me.name);
    try {
      me.at = Date.now();
    ch = await api.battleChannel(room, meInfo(asHost), {
        msg: onMsg,
        presence: onPresence,
      });
    } catch (e) { toast(e.message || '接続できませんでした', 'error'); return; }
    phase = 'lobby';
    chatOpen = false; // 初めは閉じておく（画面を隠さない）。メッセージが来ると未読の数が出る
    chat.hidden = false;
    renderLobby();
    renderChat();
    if (!asHost) {
      later(2500, () => { if (phase === 'lobby' && ![...players.values()].some((p) => p.host)) { toast('その部屋は見つかりませんでした。コードを確認してください', 'error'); leave(); phase = 'entry'; renderEntry(); } });
    }
  }

  // ---- 参加者・ホスト ----
  const meInfo = (h = isHost) => ({ id: me.id, name: me.name, host: h, at: me.at, max: cfg.max });
  const announce = () => ctx.publish?.({ t: 'open', room, name: me.name, n: players.size, max: cfg.max, kind: (KINDS.find((k) => k[0] === cfg.kind) || [])[1] || '' });
  // 部屋の公開: ロビーにいる間、定期的に「公開中」を全員に知らせる。閉じる・開始・退出で取り消す
  let pubTimer = null;
  function syncPublic() {
    const want = isHost && cfg.public && phase === 'lobby' && !!ch;
    if (want && !pubTimer) { announce(); pubTimer = setInterval(() => { if (!alive()) { stopPublic(); return; } announce(); }, 8000); }
    else if (!want && pubTimer) stopPublic();
  }
  function stopPublic() { clearInterval(pubTimer); pubTimer = null; ctx.publish?.({ t: 'close', room }); }
  function onPresence(list) {
    const prev = players;
    players = new Map(list.map((p) => [p.id, p]));
    list.forEach((p) => names.set(p.id, p.name));
    if (!alive()) return;
    if (phase !== 'entry' && players.has(me.id)) { // 部屋にいた人が抜けたら、部屋の全員に知らせる
      for (const id of prev.keys()) {
        if (players.has(id) || id === me.id || kicked.has(id)) continue;
        const nm = names.get(id) || '参加者';
        toast(`${nm} さんが退出しました`);
        sys(`${nm}さんが退出しました`);
      }
    }
    const hp = list.find((p) => p.host);
    if (!isHost && hp?.max && list.length > hp.max) { // 満員: 入った順で、最大人数に入れなかった人は退出
      const order = [...list].sort((x, y) => (x.at || 0) - (y.at || 0) || (x.id < y.id ? -1 : 1));
      if (order.findIndex((p) => p.id === me.id) >= hp.max) { toast('この部屋は満員です', 'error'); leave(); phase = 'entry'; renderEntry(); return; }
    }
    if (isHost && pubTimer) announce();
    if (!hostId) { const h = list.find((p) => p.host); if (h) hostId = h.id; }
    else if (!players.has(hostId) && players.has(me.id)) { // ホストが抜けたら、残った人の中で ID が一番小さい人が引き継ぐ
      const next = [...players.keys()].sort()[0];
      setHost(next);
    }
    if (phase === 'lobby') renderLobby(); else if (phase === 'play') renderPlayStatus();
    renderChatKeep();
  }
  // ホストを id にする。引き継ぐ側（自分）は、進行の役割（次の問題・答え合わせ）も受け持つ
  function setHost(id, silent = false) {
    if (!silent && id !== hostId) { // 新しいホストを全員に知らせる
      const nm = names.get(id) || '参加者';
      if (id === me.id) { toast('あなたがホストになりました'); sys('あなたがホストになりました'); } else { toast(`${nm} さんがホストになりました`); sys(`${nm}さんがホストになりました`); }
    }
    hostId = id;
    const was = isHost;
    isHost = id === me.id;
    if (was && !isHost) { clearHostTimers(); ch?.setMe(meInfo(false)); cfg.public = false; syncPublic(); }
    if (!was && isHost) {
      ch?.setMe(meInfo(true));
      if (game && phase === 'play') later(Math.max(500, game.perQ * 1000 + 1500 - (performance.now() - game.t0)), () => { if (phase === 'play') send({ t: 'reveal', i: game.i }); });
      else if (game && phase === 'reveal') hostRevealed(game.i);
    }
    if (phase === 'lobby') renderLobby(); else if (phase === 'final') renderFinal();
    renderChatKeep();
  }
  const sys = (text) => { chatLog.push({ sys: true, text }); };
  const kicked = new Set(); // キックされた人（退出の通知を重ねない）
  function kick(id) { if (isHost && id !== me.id) send({ t: 'kick', from: me.id, id }); }
  function transfer(id) { if (isHost && id !== me.id) send({ t: 'host', from: me.id, id }); }

  // ---- チャット ----
  function renderChat() {
    if (!alive() || phase === 'entry') return;
    const list = [...players.values()];
    chat.innerHTML = `<button type="button" class="bt-chat-toggle" id="bt-chat-toggle">💬 チャット・参加者${unread && !chatOpen ? ` <b class="bt-unread">${unread}</b>` : ''}<span class="bt-chat-arrow">${chatOpen ? '▾' : '▴'}</span></button>
      <div class="bt-chat-body" ${chatOpen ? '' : 'hidden'}>
        <ul class="bt-members">${list.map((p) => `<li class="${p.id === me.id ? 'me' : ''}"><span class="bt-mname">${p.id === hostId ? '👑 ' : ''}${esc(p.name)}</span>${isHost && p.id !== me.id ? `<button type="button" class="bt-mbtn" data-act="host" data-id="${p.id}" title="ホストを譲る">👑 譲る</button><button type="button" class="bt-mbtn bt-kick" data-act="kick" data-id="${p.id}" title="退出させる">✕ キック</button>` : ''}</li>`).join('')}</ul>
        <div class="bt-msgs" id="bt-msgs">${chatLog.map((m) => (m.sys ? `<div class="bt-sys">${esc(m.text)}</div>` : `<div class="bt-msg ${m.mine ? 'mine' : ''}"><b>${esc(m.name)}</b> ${esc(m.text)}</div>`)).join('')}</div>
        <form class="bt-chat-form" id="bt-chat-form"><input class="input" id="bt-chat-input" maxlength="200" placeholder="メッセージ（Enter で送信）" autocomplete="off"><button class="btn btn-sm" type="submit">送信</button></form>
      </div>`;
    chat.querySelector('#bt-chat-toggle').addEventListener('click', () => { chatOpen = !chatOpen; if (chatOpen) unread = 0; renderChat(); if (chatOpen) chat.querySelector('#bt-chat-input')?.focus(); });
    const box = chat.querySelector('#bt-msgs');
    if (box) box.scrollTop = box.scrollHeight;
    chat.querySelectorAll('.bt-mbtn').forEach((b) => b.addEventListener('click', () => {
      const name = names.get(b.dataset.id) || '';
      if (b.dataset.act === 'kick') { if (confirm(`${name} さんを退出させますか？`)) kick(b.dataset.id); } else if (confirm(`ホストを ${name} さんに譲りますか？`)) transfer(b.dataset.id);
    }));
    chat.querySelector('#bt-chat-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = chat.querySelector('#bt-chat-input');
      const text = inp.value.trim().slice(0, 200);
      if (!text) return;
      inp.value = '';
      send({ t: 'chat', id: me.id, name: me.name, text });
      chat.querySelector('#bt-chat-input')?.focus();
    });
  }
  // 入力中に画面が描き直されても、書きかけの文字とフォーカスを保つ
  const renderChatKeep = () => {
    const inp = chat.querySelector('#bt-chat-input');
    const v = inp?.value || '';
    const focus = document.activeElement === inp;
    renderChat();
    const n = chat.querySelector('#bt-chat-input');
    if (n) { n.value = v; if (focus) n.focus(); }
  };

  // ---- 進行（ホスト） ----
  async function hostStart() {
    if (building) return;
    building = true;
    renderLobby();
    try {
      const questions = await ctx.buildQuestions(cfg);
      if (questions.length < 3) { toast('出題できる問題が足りません。地域やカテゴリーの条件を広げてください（クイズ設定）', 'error'); return; }
      cfg.public = false; syncPublic();
      send({ t: 'start', perQ: cfg.perQ, autoNext: cfg.autoNext, questions });
      later(2000, () => send({ t: 'q', i: 0 }));
    } catch (e) { toast(`問題を作れませんでした（${e.message}）`, 'error'); } finally { building = false; if (phase === 'lobby') renderLobby(); }
  }
  const hostRevealed = (i) => { if (game?.autoNext) later(game.autoNext * 1000, () => { if (game && game.i === i && phase === 'reveal') send(i + 1 < game.questions.length ? { t: 'q', i: i + 1 } : { t: 'end' }); }); }; // ホストの設定で、一定時間後に自動で次へ
  const hostOpened = (i) => later(game.perQ * 1000 + 1500, () => { if (game && game.i === i && phase === 'play') send({ t: 'reveal', i }); });
  function checkAllAnswered() {
    if (!isHost || !game || phase !== 'play') return;
    const got = game.answers.get(game.i);
    if (got && [...players.keys()].every((id) => got.has(id))) send({ t: 'reveal', i: game.i });
  }

  // ---- 受信（全員） ----
  async function onMsg(m) {
    if (!alive()) { leave(); return; }
    if (m.t === 'start') {
      if (phase !== 'lobby') return;
      phase = 'play';
      main.innerHTML = '<p class="bt-wait">問題を準備しています…</p>';
      await ctx.prepare(m.questions);
      game = { questions: m.questions, perQ: m.perQ, autoNext: m.autoNext || 0, mine: {}, i: -1, answers: new Map(), scores: new Map(), done: new Set(), t0: 0 };
      play?.('open');
    } else if (m.t === 'q' && game) {
      clearTimers();
      game.i = m.i;
      game.t0 = performance.now();
      if (!game.answers.has(m.i)) game.answers.set(m.i, new Map());
      phase = 'play';
      play?.('slide');
      renderPlay();
      tick = setInterval(() => {
        if (!alive()) { leave(); return; }
        const left = Math.max(0, game.perQ - (performance.now() - game.t0) / 1000);
        const el = host.querySelector('#bt-timer');
        if (el) { el.textContent = Math.ceil(left); el.closest('.counter')?.classList.toggle('is-hurry', left < 5); }
      }, 200);
      if (isHost) hostOpened(m.i);
    } else if (m.t === 'ans' && game) {
      if (!game.answers.has(m.i)) game.answers.set(m.i, new Map());
      const got = game.answers.get(m.i);
      if (!got.has(m.id)) got.set(m.id, { pts: m.pts, res: m.res, label: m.label });
      if (m.i === game.i && phase === 'play') { renderPlayStatus(); checkAllAnswered(); }
    } else if (m.t === 'reveal' && game && m.i === game.i && phase === 'play') {
      clearTimers();
      phase = 'reveal';
      const got = game.answers.get(m.i) || new Map();
      if (!game.done.has(m.i)) { game.done.add(m.i); for (const [id, a] of got) game.scores.set(id, (game.scores.get(id) || 0) + a.pts); }
      const mine = got.get(me.id);
      play?.(mine?.res === 'ok' ? 'correct' : mine?.res === 'partial' ? 'partial' : 'wrong');
      renderReveal();
      if (isHost) hostRevealed(m.i);
    } else if (m.t === 'end' && game) {
      clearTimers();
      phase = 'final';
      ctx.setSvHide(false);
      play?.('finish');
      renderFinal();
    } else if (m.t === 'chat') {
      chatLog.push({ name: m.name, text: m.text, mine: m.id === me.id });
      if (chatLog.length > 100) chatLog.shift();
      if (!chatOpen && m.id !== me.id) { unread++; play?.('tap'); }
      renderChatKeep();
    } else if (m.t === 'kick') {
      if (m.from !== hostId) return;
      if (m.id === me.id) { toast('ホストにより、部屋から退出させられました', 'error'); leave(); phase = 'entry'; chat.hidden = true; renderEntry(); } else { kicked.add(m.id); sys(`${names.get(m.id) || '参加者'}さんが退出させられました`); renderChatKeep(); }
    } else if (m.t === 'host') {
      if (m.from !== hostId) return;
      setHost(m.id);
    } else if (m.t === 'lobby') {
      clearTimers();
      game = null;
      phase = 'lobby';
      ctx.setSvHide(false);
      renderLobby();
    }
  }

  // ---- 回答 ----
  // res: ok / partial / ng、pts: 得点（正解は速いほど高い）、label: みんなに見せる答えの表示
  function submit({ res, pts, label, pick }) {
    const got = game?.answers.get(game.i);
    if (phase !== 'play' || got?.has(me.id)) return;
    host.querySelectorAll('.bt-choices .choice, #bt-send, #bt-guess, #bt-input').forEach((b) => { b.disabled = true; });
    if (pick != null) { // 自分が選んだ選択肢を目立たせる（ほかの人が答えるのを待つ間）
      const box = host.querySelector('.bt-choices');
      box?.classList.add('answered');
      box?.querySelectorAll('.choice').forEach((b) => b.classList.toggle('picked', (b.dataset.code ?? b.dataset.key) === pick));
    }
    const el = host.querySelector('#bt-mine');
    if (el) el.textContent = '✔ 回答しました。ほかの人を待っています…';
    send({ t: 'ans', id: me.id, i: game.i, res, pts, label });
  }
  const msNow = () => performance.now() - game.t0;
  const scoreOf = (res) => { const b = bonus(msNow(), game.perQ); return res === 'ok' ? Math.round(500 + 500 * b) : res === 'partial' ? Math.round(150 + 150 * b) : 0; };

  // ---- 画面 ----
  const board = () => {
    const ids = new Set([...names.keys()].filter((id) => players.has(id) || game?.scores.has(id)));
    return [...ids].map((id) => ({ id, name: names.get(id) || '?', score: game?.scores.get(id) || 0 })).sort((a, b) => b.score - a.score);
  };
  const boardHtml = () => `<ol class="bt-board">${board().map((p, i) => `<li class="${p.id === me.id ? 'me' : ''}"><span class="bt-rank">${medal(i)}</span><span class="bt-pname">${esc(p.name)}</span><b class="bt-score">${p.score.toLocaleString()}</b></li>`).join('')}</ol>`;
  const head = (title, extra = '') => `<div class="bt-head"><h2>👥 ${title}</h2><div class="bt-head-actions">${extra}<button type="button" class="btn btn-ghost btn-sm" id="bt-exit">${phase === 'entry' ? '← 戻る' : '退出'}</button></div></div>`;
  // 退出: ホストが抜けるときは、先に別の人へホストを渡してから抜ける
  const bindExit = () => host.querySelector('#bt-exit')?.addEventListener('click', async () => {
    if (isHost && ch && players.size > 1) {
      const next = [...players.keys()].filter((id) => id !== me.id).sort()[0];
      send({ t: 'host', from: me.id, id: next });
      await new Promise((r) => setTimeout(r, 200));
    }
    leave();
    onExit();
  });

  function renderEntry() {
    if (!alive()) return;
    main.innerHTML = `${head('リアルタイム対戦')}
      <p class="muted small">部屋を作って、表示されたコードを友達に伝えます。同じコードを入力した人と、同じ問題を同時に解いて、速さと正解で得点を競います。出題内容と回答方式は、ホストが選びます。デモモードでは、同じブラウザの別タブで試せます。</p>
      <div class="bt-form">
        <label class="bt-label">あなたの名前<input id="bt-name" class="input" maxlength="16" value="${esc(me.name)}" placeholder="例: たろう"></label>
        <div class="bt-row"><button type="button" class="btn btn-primary" id="bt-create">🆕 部屋を作る</button></div>
        <div class="bt-row"><input id="bt-code" class="input bt-code" maxlength="5" placeholder="部屋のコード（5 文字）" autocapitalize="characters"><button type="button" class="btn" id="bt-join">入る</button></div>
      </div>
      <h3 class="bt-sub">📢 公開中の部屋</h3><div id="bt-pubrooms"></div>`;
    drawPublic();
    bindExit();
    host.querySelector('#bt-create').addEventListener('click', () => join(newCode(), true));
    const go = () => { const c = host.querySelector('#bt-code').value.trim().toUpperCase(); if (c.length < 5) { toast('部屋のコード（5 文字）を入力してください', 'error'); return; } join(c, false); };
    host.querySelector('#bt-join').addEventListener('click', go);
    host.querySelector('#bt-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }
  // 入口に、公開中の部屋の一覧（ポップアップは一度しか出ないので、あとはここから入れる）
  function drawPublic() {
    const box = main.querySelector('#bt-pubrooms');
    if (!box) return;
    const list = publicRooms();
    box.innerHTML = list.length ? list.map((r) => `<div class="bt-pubroom"><div><b>${esc(r.name)}</b> さんの部屋 <span class="bt-room small">${esc(r.code)}</span><div class="muted small">${esc(r.kind)} ・ ${r.n} / ${r.max} 人</div></div><button type="button" class="btn btn-primary btn-sm" data-code="${esc(r.code)}">参加する</button></div>`).join('') : '<p class="muted small">公開中の部屋はありません。ホストが「部屋を公開する」を押すと、ここに出ます。</p>';
    box.querySelectorAll('[data-code]').forEach((x) => x.addEventListener('click', () => join(x.dataset.code, false)));
  }
  let unwatch = () => {};
  unwatch = (() => { const f = () => { if (!alive()) { unwatch(); return; } if (phase === 'entry') drawPublic(); }; roomListeners.add(f); const t = setInterval(f, 5000); return () => { roomListeners.delete(f); clearInterval(t); }; })();
  // スライダー（動かしている間は数字だけ更新し、離したときに設定へ反映する）
  const sliderFmt = { 'bt-max': (n) => `${n} 人`, 'bt-qn': (n) => `${n} 問`, 'bt-pq': (n) => `${n} 秒`, 'bt-an': (n) => (n ? `${n} 秒後に自動` : '手動') };
  const sliderHtml = (id, min, max, step, val) => `<div class="bt-slider"><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><output id="${id}-v">${sliderFmt[id](val)}</output></div>`;
  const segHtml = (id, opts, cur) => `<div class="seg ${opts.length > 4 ? 'seg-wrap' : ''}" id="${id}">${opts.map(([v, label]) => `<button type="button" class="${cur === v ? 'on' : ''}" data-v="${v}">${label}</button>`).join('')}</div>`;
  function renderLobby() {
    if (!alive()) return;
    host.classList.remove('bt-play');
    ctx.setFit('scroll');
    const list = [...players.values()];
    if (!modesOf(cfg.kind).includes(cfg.mode)) cfg.mode = modesOf(cfg.kind)[0];
    const counts = isHost ? ctx.scopeCounts(cfg) : { regions: new Map(), cats: new Map() };
    main.innerHTML = `${head(`部屋 <span class="bt-room">${esc(room)}</span>`, isHost ? `<button type="button" class="btn btn-sm ${cfg.public ? 'btn-primary' : ''}" id="bt-public" title="${cfg.public ? '今このサイトを開いている全員に、参加用のポップアップを出しています（押すと非公開）' : '押すと、このサイトを開いている全員に「参加する」ポップアップが出ます'}">${cfg.public ? '📢 公開中' : '📢 部屋を公開する'}</button>` : '')}
      <p class="muted small">このコードを友達に伝えてください。${isHost ? '全員そろったら「開始」を押します。' : 'ホストが開始するのを待っています。'}</p>
      <ul class="bt-players">${list.map((p) => `<li class="${p.id === me.id ? 'me' : ''}">${p.host ? '👑 ' : ''}${esc(p.name)}</li>`).join('') || '<li class="muted">接続中…</li>'}</ul>
      ${isHost ? `<div class="bt-settings quiz-setup">
        <h3 class="bt-sub">部屋の設定</h3>
        <div class="setup-block"><div class="setup-label"><span>出題内容</span></div>${segHtml('bt-kind', KINDS, cfg.kind)}</div>
        ${cfg.kind === 'photo' ? `<div class="setup-block"><div class="setup-label"><span>写真の種類</span></div>
          <div class="seg seg-wrap" id="bt-ptopic">${ctx.photoTopics.map((t) => `<button type="button" class="${cfg.photoTopics.has(t.id) ? 'on' : ''}" data-id="${t.id}">${t.icon} ${esc(t.name)}</button>`).join('')}</div></div>` : ''}
        ${cfg.kind === 'sv' ? `<div class="setup-block"><div class="setup-label"><span>出題する地点</span></div>${segHtml('bt-svsrc', [['random', '🎲 ランダムな道路'], ['ref', '📷 GeoHints の写真の地点だけ']], cfg.svSource)}</div>` : ''}
        ${cfg.kind === 'fact' ? `<div class="setup-block"><div class="setup-label"><span>答える特徴</span></div>${segHtml('bt-topic', ctx.factTopics.map((t) => [t.id, `${t.icon} ${esc(t.name)}`]), cfg.topic)}
          <p class="muted small">国旗と国名を見て、その国の特徴を 4 択で答えます</p></div>` : ''}
        <div class="setup-block">
          <div class="setup-label"><span>出題する地域</span><span class="setup-actions"><button type="button" class="link-btn" id="bt-rall">すべて選択</button><button type="button" class="link-btn" id="bt-rnone">すべて解除</button></span></div>
          <div class="region-grid">${ctx.regions.map((r) => `<label class="region-check ${counts.regions.get(r.id) ? '' : 'is-empty'}"><input type="checkbox" data-region="${r.id}" ${cfg.regions.has(r.id) ? 'checked' : ''}><span>${esc(r.name)}</span><span class="count">${counts.regions.get(r.id) || 0}</span></label>`).join('')}</div>
        </div>
        ${cfg.kind === 'cards' ? `<div class="setup-block">
          <div class="setup-label"><span>カテゴリー</span><span class="setup-actions"><button type="button" class="link-btn" id="bt-call">すべて選択</button><button type="button" class="link-btn" id="bt-cnone">すべて解除</button></span></div>
          <div class="region-grid cat-grid">${ctx.categories.map((c) => `<label class="region-check cat-check ${counts.cats.get(c.key) ? '' : 'is-empty'}" style="${c.vars}"><input type="checkbox" data-cat="${esc(c.key)}" ${cfg.catsOff.has(c.key) ? '' : 'checked'}><span class="cat-dot"></span><span>${esc(c.name)}</span><span class="count">${counts.cats.get(c.key) || 0}</span></label>`).join('')}</div>
        </div>` : ''}
        <div class="setup-row">
          <div class="setup-block"><div class="setup-label"><span>最大人数</span></div>${sliderHtml('bt-max', 2, 20, 1, cfg.max)}</div>
          <div class="setup-block"><div class="setup-label"><span>問題数</span></div>${sliderHtml('bt-qn', 3, 50, 1, cfg.qn)}</div>
          ${cfg.kind === 'fact' ? '' : `<div class="setup-block"><div class="setup-label"><span>回答方式</span></div>${segHtml('bt-mode', modesOf(cfg.kind).map((m) => [m, MODES[m]]), cfg.mode)}</div>`}
          <div class="setup-block"><div class="setup-label"><span>1 問の制限時間</span></div>${sliderHtml('bt-pq', 5, 120, 5, cfg.perQ)}</div>
          <div class="setup-block"><div class="setup-label"><span>答え合わせから次の問題へ</span></div>${sliderHtml('bt-an', 0, 60, 5, cfg.autoNext)}</div>
        </div>
        <button type="button" class="btn btn-primary btn-lg" id="bt-start" ${list.length && !building && cfg.regions.size ? '' : 'disabled'}>${building ? '問題を作成中…' : `▶ 開始（${list.length} 人）`}</button></div>` : ''}`;
    bindExit();
    if (!isHost) return;
    const pick = (id, key, num) => main.querySelectorAll(`#${id} button`).forEach((x) => x.addEventListener('click', () => { cfg[key] = num ? Number(x.dataset.v) : x.dataset.v; if (key === 'max') { ch?.setMe(meInfo()); if (pubTimer) announce(); } renderLobby(); }));
    pick('bt-kind', 'kind'); pick('bt-mode', 'mode'); pick('bt-topic', 'topic'); pick('bt-svsrc', 'svSource');
    for (const [id, key] of [['bt-max', 'max'], ['bt-qn', 'qn'], ['bt-pq', 'perQ'], ['bt-an', 'autoNext']]) {
      const r = main.querySelector(`#${id}`);
      if (!r) continue;
      r.addEventListener('input', () => { main.querySelector(`#${id}-v`).textContent = sliderFmt[id](Number(r.value)); });
      r.addEventListener('change', () => {
        cfg[key] = Number(r.value);
        if (key === 'max') { ch?.setMe(meInfo()); if (pubTimer) announce(); }
        renderLobby();
      });
    }
    main.querySelector('#bt-public')?.addEventListener('click', () => { cfg.public = !cfg.public; syncPublic(); renderLobby(); });
    const redo = () => { saveScope(); renderLobby(); };
    main.querySelectorAll('[data-region]').forEach((x) => x.addEventListener('change', () => { if (x.checked) cfg.regions.add(x.dataset.region); else cfg.regions.delete(x.dataset.region); redo(); }));
    main.querySelectorAll('[data-cat]').forEach((x) => x.addEventListener('change', () => { if (x.checked) cfg.catsOff.delete(x.dataset.cat); else cfg.catsOff.add(x.dataset.cat); redo(); }));
    main.querySelectorAll('#bt-ptopic button').forEach((x) => x.addEventListener('click', () => { const id = x.dataset.id; if (cfg.photoTopics.has(id)) { if (cfg.photoTopics.size > 1) cfg.photoTopics.delete(id); } else cfg.photoTopics.add(id); redo(); }));
    main.querySelector('#bt-rall')?.addEventListener('click', () => { ctx.regions.forEach((r) => cfg.regions.add(r.id)); redo(); });
    main.querySelector('#bt-rnone')?.addEventListener('click', () => { cfg.regions.clear(); redo(); });
    main.querySelector('#bt-call')?.addEventListener('click', () => { cfg.catsOff.clear(); redo(); });
    main.querySelector('#bt-cnone')?.addEventListener('click', () => { ctx.categories.forEach((c) => cfg.catsOff.add(c.key)); redo(); });
    host.querySelector('#bt-start').addEventListener('click', hostStart);
  }

  function renderPlay() {
    const Q = game.questions[game.i];
    // 単独プレイと同じ見た目・大きさ（画面いっぱいの問題カード、下に選択肢）
    const top = `<div class="toolbar"><span class="counter">第 ${game.i + 1} 問 / ${game.questions.length}</span><span class="counter qt-counter">⏱ <b id="bt-timer">${game.perQ}</b> 秒</span><span class="muted small" id="bt-status"></span><span class="muted small" id="bt-mine"></span><span class="grow"></span>${isHost ? '<button type="button" class="btn btn-sm" id="bt-force" title="まだ答えていない人を待たずに、いますぐ答え合わせにする">⏩ 答え合わせにする</button>' : ''}<button type="button" class="btn btn-ghost btn-sm" id="bt-exit">退出</button></div>
      <div class="progress"><div class="progress-bar" style="width:${(game.i / game.questions.length) * 100}%"></div></div>`;
    host.classList.add('bt-play');
    ctx.setFit(true);
    ctx.setSvHide(true);
    if (Q.k === 'fact') {
      const item = Q.item;
      main.innerHTML = `${top}<div class="quiz-card fact-card"><img class="fact-flag" src="${esc(ctx.flagUrl(item.code))}" alt=""><div class="fact-country">${esc(countryName(item.code))}</div></div>
        <div class="quiz-bottom"><p class="quiz-prompt">この国の${esc(Q.topicIcon)} ${esc(Q.topicName)}は？</p>
        <div class="choices bt-choices fact-choices">${item.options.map((o, i) => `<button type="button" class="choice" data-key="${esc(o.key)}"><span class="kbd">${i + 1}</span>${o.swatch}<span>${esc(o.label)}</span></button>`).join('')}</div></div>`;
      bindExit();
      host.querySelectorAll('.bt-choices .choice').forEach((b) => b.addEventListener('click', () => {
        const res = b.dataset.key === item.answer ? 'ok' : 'ng';
        submit({ res, pts: scoreOf(res), label: item.options.find((o) => o.key === b.dataset.key)?.label || '', pick: b.dataset.key });
      }));
      renderPlayStatus();
      bindForce();
      return;
    }
    const card = ctx.cardFor(Q);
    if (!card) { main.innerHTML = `${top}<p class="muted">この問題のカードを読み込めませんでした。次の問題をお待ちください。</p>`; bindExit(); return; }
    const front = `<div class="quiz-card">${frontHtml(card, false, false)}</div>`;
    if (Q.mode === 'choice') {
      main.innerHTML = `${top}${card.sv ? '<div class="sv-overlay-wrap">' : ''}${front}<div class="quiz-bottom"><div class="choices bt-choices">${Q.options.map((code, i) => `<button type="button" class="choice" data-code="${code}"><span class="key">${i + 1}</span>${flagImg(code)}<span>${esc(countryName(code))}</span></button>`).join('')}</div></div>${card.sv ? '</div>' : ''}`;
      bindExit();
      host.querySelectorAll('.bt-choices .choice').forEach((b) => b.addEventListener('click', () => {
        const res = card.countries.includes(b.dataset.code) ? 'ok' : 'ng';
        submit({ res, pts: scoreOf(res), label: countryName(b.dataset.code), pick: b.dataset.code });
      }));
    } else if (Q.mode === 'input') {
      const need = card.countries.length;
      const draft = [];
      main.innerHTML = `${top}${card.sv ? '<div class="sv-overlay-wrap">' : ''}${front}<div class="quiz-bottom"><div class="bt-input-row"><div class="bt-chips" id="bt-chips"></div>
        <input type="text" id="bt-input" class="input" list="country-list" placeholder="${need > 1 ? `国名を入力して Enter で追加（${need} か国）` : '国名を入力して Enter（例: ポーランド / Poland）'}" autocomplete="off">
        <button type="button" class="btn btn-primary" id="bt-send">回答</button></div></div>${card.sv ? '</div>' : ''}`;
      bindExit();
      const chips = () => { host.querySelector('#bt-chips').innerHTML = draft.map((c) => `<span class="chip">${flagImg(c)}${esc(countryName(c))}</span>`).join(''); };
      const finish = () => {
        if (!draft.length) return;
        const res = ctx.judge(card, 'input', draft).result;
        submit({ res, pts: scoreOf(res), label: draft.map(countryName).join('・') });
      };
      const input = host.querySelector('#bt-input');
      input.focus();
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault();
        const code = ctx.resolveCountryCode(input.value);
        if (code && !draft.includes(code)) { draft.push(code); chips(); }
        input.value = '';
        if (draft.length >= need) finish();
      });
      host.querySelector('#bt-send').addEventListener('click', finish);
    } else { // map / pin: 左に問題、右下に地図
      main.innerHTML = `${top}<div class="qm-layout qm-float bt-qm"><div class="quiz-card">${frontHtml(card, false, false)}</div>
        <div class="qm-side"><div class="quiz-map" id="bt-map"><div class="map-loading">地図を読み込み中…</div></div>

        ${Q.mode === 'pin' ? '<button class="btn btn-primary qm-guess" id="bt-guess" type="button" disabled>📍 この場所で回答</button>' : ''}</div></div>`;
      bindExit();
      const at = game.i;
      if (Q.mode === 'map') {
        ctx.mountQuizMap(host.querySelector('#bt-map'), { answers: card.countries, answered: null, qid: `bt${at}`, animate: false, onPick: (code) => {
          if (game.i !== at) return;
          const r = ctx.judge(card, 'map', [code]).result;
          game.mine[at] = { code };
          submit({ res: r, pts: scoreOf(r), label: countryName(code) });
        } }).then(() => host.querySelector('#bt-map .map-loading')?.remove()).catch(() => {});
      } else {
        let pending = null;
        ctx.mountPinMap(host.querySelector('#bt-map'), { answer: [card.lat, card.lng], qid: `bt${at}`, animate: false, onPlace: (g) => { pending = g; const b = host.querySelector('#bt-guess'); if (b) b.disabled = false; } })
          .then(() => host.querySelector('#bt-map .map-loading')?.remove()).catch(() => {});
        host.querySelector('#bt-guess').addEventListener('click', () => {
          if (!pending || game.i !== at) return;
          game.mine[at] = { guess: pending };
          const km = ctx.distanceBetween(pending, [card.lat, card.lng]);
          const pts = Math.round(1000 * Math.exp(-km / 1500) * (0.8 + 0.2 * bonus(msNow(), game.perQ)));
          submit({ res: km <= 150 ? 'ok' : km <= 750 ? 'partial' : 'ng', pts, label: `約 ${Math.round(km).toLocaleString()} km` });
        });
      }
    }
    ctx.attachZoom(host.querySelector('.quiz-card .front-img')); // ホイールで拡大・ドラッグで移動（単独プレイと同じ）
    renderPlayStatus();
    bindForce();
  }
  // ホスト: 答えていない人を待たずに、いますぐ答え合わせにする
  function bindForce() {
    host.querySelector('#bt-force')?.addEventListener('click', () => { if (isHost && phase === 'play') send({ t: 'reveal', i: game.i }); });
  }
  function renderPlayStatus() {
    const el = host.querySelector('#bt-status');
    if (!el || !game) return;
    const got = game.answers.get(game.i);
    el.textContent = `回答 ${[...players.keys()].filter((id) => got?.has(id)).length} / ${players.size} 人`;
  }

  function renderReveal() {
    host.classList.add('bt-play'); // 単独プレイと同じ画面構成（画面いっぱいの問題カード＋スクロールできる下の欄）
    ctx.setFit(true);
    const Q = game.questions[game.i];
    const got = game.answers.get(game.i) || new Map();
    const mine = got.get(me.id);
    ctx.setSvHide(false);
    let info;
    let cardHtml;
    let choices = '';
    let sv = false;
    if (Q.k === 'fact') {
      const item = Q.item;
      cardHtml = `<div class="quiz-card fact-card"><img class="fact-flag" src="${esc(ctx.flagUrl(item.code))}" alt=""><div class="fact-country">${esc(countryName(item.code))}</div></div>`;
      choices = `<div class="choices fact-choices bt-choices">${item.options.map((o) => `<div class="choice ${o.key === item.answer ? 'correct' : 'dim'}">${o.swatch}<span>${esc(o.label)}</span></div>`).join('')}</div>`;
      info = `<div class="pfact">${ctx.factPanelHtml(Q.topic, item.code)}</div>`;
    } else {
      const card = ctx.cardFor(Q);
      cardHtml = `<div class="quiz-card">${card ? frontHtml(card, false, true) : ''}</div>`;
      info = card ? `${ctx.answerHtml(card, 'sm', true)}${ctx.cardInfoHtml(card)}` : '';
      sv = !!card?.sv;
    }
    // 現在の順位に、この問題の結果（○✗・答え・得点）を並べる。答え合わせと一緒に、スクロールせずに見える位置に置く
    const rows = board().map((p, i) => {
      const a = got.get(p.id);
      return `<li class="${p.id === me.id ? 'me' : ''}"><span class="bt-rank">${medal(i)}</span><span class="bt-pname">${esc(p.name)}</span><span class="bt-res res-${a?.res || 'ng'}">${a ? { ok: '○', partial: '△', ng: '✗' }[a.res] : '－'}</span><span class="bt-label">${a ? esc(a.label || '') : '未回答'}</span><span class="bt-gain">+${(a?.pts || 0).toLocaleString()}</span><b class="bt-score">${p.score.toLocaleString()}</b></li>`;
    }).join('');
    // 地図で答える問題: 自分の答えと正解がわかる地図を、画像・ストリートビューの下に出す
    const card0 = Q.k === 'card' ? ctx.cardFor(Q) : null;
    const showMap = !!card0 && ((Q.mode === 'map') || (Q.mode === 'pin' && card0.lat != null));
    const mediaHtml = showMap ? `<div class="bt-media">${cardHtml}<div class="quiz-map bt-rmap" id="bt-rmap"><div class="map-loading">地図を読み込み中…</div></div></div>` : cardHtml;
    const last = game.i + 1 >= game.questions.length;
    const title = mine ? { ok: '○ 正解！', partial: '△ 惜しい', ng: '✗ 不正解' }[mine.res] : '⏱ 未回答';
    const toolbar = `<div class="toolbar"><span class="counter">第 ${game.i + 1} 問 / ${game.questions.length} の答え</span><span class="grow"></span><button type="button" class="btn btn-ghost btn-sm" id="bt-exit">退出</button></div>
      <div class="progress"><div class="progress-bar" style="width:${((game.i + 1) / game.questions.length) * 100}%"></div></div>`;
    const bottom = `<div class="quiz-bottom is-answered">${choices}
      <div class="feedback fb-${mine?.res || 'ng'}">
        <div class="feedback-head"><div class="feedback-title">${title}${mine ? ` <small>+${mine.pts.toLocaleString()} 点</small>` : ''}</div>
          ${isHost ? `<button type="button" class="btn btn-primary" id="bt-next">${last ? '結果発表へ' : '次の問題へ'}</button>` : ''}</div>
        <h3 class="bt-sub">現在の順位（今回の得点つき）</h3><ul class="bt-board bt-results">${rows}</ul>
        ${info}
        <p class="muted small">${game.autoNext ? `${game.autoNext} 秒後に自動で${last ? '結果発表へ' : '次の問題へ'}進みます${isHost ? '（ボタンを押すとすぐに進みます）' : ''}` : isHost ? `準備ができたら「${last ? '結果発表へ' : '次の問題へ'}」を押してください` : `ホストが「${last ? '結果発表へ' : '次の問題へ'}」を押すのを待っています…`}</p>
      </div></div>`;
    // 画像・ストリートビューは右に大きく、答えと結果は左に（答え合わせでも画像が小さくならないように）
    main.innerHTML = `${toolbar}${Q.k !== 'fact' ? `<div class="sv-split">${bottom}${mediaHtml}</div>` : `${cardHtml}${bottom}`}`;
    bindExit();
    ctx.attachZoom(host.querySelector('.quiz-card .front-img'));
    if (showMap) {
      const el = host.querySelector('#bt-rmap');
      const my = game.mine[game.i];
      const at = game.i;
      const done = () => { if (game.i === at) host.querySelector('#bt-rmap .map-loading')?.remove(); };
      if (Q.mode === 'map') ctx.mountQuizMap(el, { answers: card0.countries, answered: { given: my?.code ? [my.code] : [] }, qid: `br${at}`, animate: false, onPick: () => {} }).then(done).catch(() => {});
      else ctx.mountPinMap(el, { answer: [card0.lat, card0.lng], guess: my?.guess, reveal: !my?.guess, qid: `br${at}`, animate: false }).then(done).catch(() => {});
    }
    main.querySelector('#bt-next')?.addEventListener('click', () => { // ホスト: 続けるボタンですぐに次へ
      if (!isHost || phase !== 'reveal') return;
      clearHostTimers();
      send(last ? { t: 'end' } : { t: 'q', i: game.i + 1 });
    });
  }
  function renderFinal() {
    host.classList.remove('bt-play');
    ctx.setFit('scroll');
    main.innerHTML = `${head('結果発表')}
      <div class="bt-final">${boardHtml()}</div>
      <div class="bt-row">${isHost ? '<button type="button" class="btn btn-primary" id="bt-again">もう一度（ロビーへ）</button>' : '<span class="muted small">ホストが「もう一度」を押すと、ロビーに戻ります</span>'}</div>`;
    bindExit();
    host.querySelector('#bt-again')?.addEventListener('click', () => send({ t: 'lobby' }));
  }

  renderEntry();
  if (ctx.autoJoin) { // 公開された部屋のポップアップから来たとき: コードを入れておき、名前があればそのまま入る
    const c = host.querySelector('#bt-code');
    if (c) c.value = ctx.autoJoin;
    if (me.name) join(ctx.autoJoin, false); else host.querySelector('#bt-name')?.focus();
  }
  return { leave, inRoom: () => phase !== 'entry' };
}

// 公開された対戦の部屋のお知らせ（アプリ全体で 1 つ）。ポップアップは部屋ごとに一度だけ（数秒で消える）。あとは対戦の入口の一覧から入れる
export function watchPublicRooms({ api, esc, onJoin, busy }) {
  if (!api.openLobby) return;
  let box = null;
  const POP_MS = 12000;
  const draw = () => {
    const list = [...roomsStore].filter(([, r]) => r.popped && !r.dismissed && r.n < r.max && Date.now() - r.seen < FRESH_MS);
    if (!list.length || busy()) { box?.remove(); box = null; return; }
    if (!box?.isConnected) { box = document.createElement('div'); box.className = 'bt-popups'; document.body.appendChild(box); }
    box.innerHTML = list.map(([code, r]) => `<div class="bt-popup" role="alert"><div class="bt-popup-text">🎮 <b>${esc(r.name)}</b> さんが対戦の部屋を公開しました<div class="muted small">${esc(r.kind)} ・ ${r.n} / ${r.max} 人 ・ あとから「リアルタイム対戦」でも入れます</div></div><button type="button" class="btn btn-primary btn-sm" data-join="${esc(code)}">参加する</button><button type="button" class="bt-popup-x" data-x="${esc(code)}" aria-label="閉じる">✕</button></div>`).join('');
    box.querySelectorAll('[data-join]').forEach((x) => x.addEventListener('click', () => { const r = roomsStore.get(x.dataset.join); if (r) r.dismissed = true; draw(); onJoin(x.dataset.join); }));
    box.querySelectorAll('[data-x]').forEach((x) => x.addEventListener('click', () => { const r = roomsStore.get(x.dataset.x); if (r) r.dismissed = true; draw(); }));
  };
  api.openLobby((m) => {
    if (m?.t === 'open' && m.room) {
      const old = roomsStore.get(m.room);
      const r = old || { popped: false, dismissed: false };
      Object.assign(r, { name: m.name, n: m.n, max: m.max, kind: m.kind, seen: Date.now() });
      roomsStore.set(m.room, r);
      if (!old && !busy()) { // 初めて見た部屋: ポップアップを一度だけ出して、数秒後に自動で消す
        r.popped = true;
        setTimeout(() => { r.dismissed = true; draw(); }, POP_MS);
      } else if (!old) r.dismissed = true;
      draw();
    } else if (m?.t === 'close') roomsStore.delete(m.room);
    else return;
    notifyRooms();
  }).then((lobby) => { watchPublicRooms.lobby = lobby; }).catch(() => {});
  setInterval(() => { for (const [c, r] of roomsStore) if (Date.now() - r.seen > FRESH_MS) roomsStore.delete(c); draw(); notifyRooms(); }, 5000); // 応答が途絶えた部屋を消す
}
