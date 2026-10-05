// クイズのリアルタイム対戦（部屋のコードで集まり、同じ問題を同時に解いて得点を競う）
// 通信は Supabase Realtime の Broadcast / Presence（テーブルは使わない）。デモモードでは同じブラウザの別タブどうしで試せる
// 進行役（ホスト）が問題を出す合図（q）と答え合わせ（reveal）を送り、得点は全員が同じ計算で出す
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 5 }, () => ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)]).join('');
const newId = () => Math.random().toString(36).slice(2, 10);
const NAME_KEY = 'geo-cards-battle-name';
const REVEAL_MS = 5000; // 答え合わせを見せる時間
const points = (ok, ms, limit) => (ok ? Math.round(1000 - 500 * Math.min(1, ms / (limit * 1000))) : 0);
const medal = (i) => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;

export function mountBattle(host, ctx) {
  const { api, esc, getCards, makeOptions, cardById, frontHtml, countryName, flagImg, play, onExit, toast } = ctx;
  const me = { id: newId(), name: '' };
  try { me.name = localStorage.getItem(NAME_KEY) || ''; } catch { /* 無視 */ }
  let ch = null; // 通信（send / leave）
  let room = '';
  let isHost = false;
  let phase = 'entry'; // entry → lobby → play → reveal → final
  let players = new Map(); // id → { id, name, host }（今つながっている人）
  const names = new Map(); // id → 名前（途中で抜けた人の成績も出すため）
  let game = null;
  let tick = null;
  let hostTimers = [];
  const alive = () => host.isConnected;

  const settings = { qn: 10, perQ: 20 };
  const clearTimers = () => { clearInterval(tick); tick = null; hostTimers.forEach(clearTimeout); hostTimers = []; };
  const later = (ms, fn) => { hostTimers.push(setTimeout(() => { if (alive()) fn(); }, ms)); };
  function leave() { clearTimers(); try { ch?.leave(); } catch { /* 無視 */ } ch = null; }

  const send = (m) => ch?.send(m);

  async function join(code, asHost) {
    me.name = (host.querySelector('#bt-name')?.value || me.name || '').trim().slice(0, 16) || `プレイヤー${Math.floor(Math.random() * 90 + 10)}`;
    try { localStorage.setItem(NAME_KEY, me.name); } catch { /* 無視 */ }
    room = code;
    isHost = asHost;
    names.set(me.id, me.name);
    ch = await api.battleChannel(room, { id: me.id, name: me.name, host: asHost }, {
      msg: onMsg,
      presence: (list) => { players = new Map(list.map((p) => [p.id, p])); list.forEach((p) => names.set(p.id, p.name)); if (alive()) { if (phase === 'lobby') render(); else if (phase === 'play') renderPlayStatus(); } },
    });
    phase = 'lobby';
    render();
    if (!asHost) {
      later(2500, () => { if (phase === 'lobby' && ![...players.values()].some((p) => p.host)) { toast('その部屋は見つかりませんでした。コードを確認してください', 'error'); leave(); phase = 'entry'; render(); } });
    }
  }

  // ---- 進行（ホスト） ----
  function hostStart() {
    const pool = getCards();
    if (pool.length < 4) { toast('出題できるカードが足りません（4 枚以上）', 'error'); return; }
    const picked = pool.slice().sort(() => Math.random() - 0.5).slice(0, settings.qn);
    send({ t: 'start', perQ: settings.perQ, questions: picked.map((c) => ({ cardId: c.id, options: makeOptions(c) })) });
    later(1800, () => send({ t: 'q', i: 0 }));
  }
  function hostOpened(i) {
    later(game.perQ * 1000 + 1200, () => { if (game && game.i === i && phase === 'play') send({ t: 'reveal', i }); });
  }
  function hostRevealed(i) {
    later(REVEAL_MS, () => {
      if (!game || game.i !== i) return;
      if (i + 1 < game.questions.length) send({ t: 'q', i: i + 1 }); else send({ t: 'end' });
    });
  }
  function checkAllAnswered() {
    if (!isHost || !game || phase !== 'play') return;
    const got = game.answers.get(game.i);
    if (got && [...players.keys()].every((id) => got.has(id))) send({ t: 'reveal', i: game.i });
  }

  // ---- 受信（全員） ----
  function onMsg(m) {
    if (!alive()) { leave(); return; }
    if (m.t === 'start') {
      if (phase !== 'lobby') return;
      game = { questions: m.questions, perQ: m.perQ, i: -1, answers: new Map(), scores: new Map(), done: new Set(), t0: 0 };
      phase = 'play';
      play?.('open');
      host.innerHTML = '<p class="bt-wait">まもなく開始します…</p>';
    } else if (m.t === 'q' && game) {
      clearTimers();
      game.i = m.i;
      game.t0 = performance.now();
      game.answers.set(m.i, game.answers.get(m.i) || new Map());
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
      const got = game.answers.get(m.i) || new Map();
      game.answers.set(m.i, got);
      if (!got.has(m.id)) got.set(m.id, { choice: m.choice, ms: m.ms });
      if (m.i === game.i && phase === 'play') { renderPlayStatus(); checkAllAnswered(); }
    } else if (m.t === 'reveal' && game && m.i === game.i && phase === 'play') {
      clearTimers();
      phase = 'reveal';
      const item = game.questions[m.i];
      const card = cardById(item.cardId);
      const correct = new Set(card?.countries || []);
      const got = game.answers.get(m.i) || new Map();
      if (!game.done.has(m.i)) {
        game.done.add(m.i);
        for (const [id, a] of got) game.scores.set(id, (game.scores.get(id) || 0) + points(correct.has(a.choice), a.ms, game.perQ));
      }
      const mine = got.get(me.id);
      play?.(mine && correct.has(mine.choice) ? 'correct' : 'wrong');
      renderReveal();
      if (isHost) hostRevealed(m.i);
    } else if (m.t === 'end' && game) {
      clearTimers();
      phase = 'final';
      play?.('finish');
      renderFinal();
    } else if (m.t === 'lobby') {
      clearTimers();
      game = null;
      phase = 'lobby';
      render();
    }
  }

  // ---- 画面 ----
  const board = () => {
    const ids = new Set([...names.keys()].filter((id) => players.has(id) || game?.scores.has(id)));
    return [...ids].map((id) => ({ id, name: names.get(id) || '?', score: game?.scores.get(id) || 0 })).sort((a, b) => b.score - a.score);
  };
  const boardHtml = () => `<ol class="bt-board">${board().map((p, i) => `<li class="${p.id === me.id ? 'me' : ''}"><span class="bt-rank">${medal(i)}</span><span class="bt-pname">${esc(p.name)}</span><b class="bt-score">${p.score.toLocaleString()}</b></li>`).join('')}</ol>`;
  const head = (title) => `<div class="bt-head"><h2>👥 ${title}</h2><button type="button" class="btn btn-ghost btn-sm" id="bt-exit">${phase === 'entry' ? '← 戻る' : '退出'}</button></div>`;
  const bindExit = () => host.querySelector('#bt-exit')?.addEventListener('click', () => { leave(); onExit(); });

  function render() {
    if (!alive()) return;
    if (phase === 'entry') return renderEntry();
    if (phase === 'lobby') return renderLobby();
  }
  function renderEntry() {
    host.innerHTML = `${head('リアルタイム対戦')}
      <p class="muted small">部屋を作って、表示されたコードを友達に伝えます。同じコードを入力した人と、同じ問題（4 択）を同時に解いて、速さと正解で得点を競います。デモモードでは、同じブラウザの別タブで試せます。</p>
      <div class="bt-form">
        <label class="bt-label">あなたの名前<input id="bt-name" class="input" maxlength="16" value="${esc(me.name)}" placeholder="例: たろう"></label>
        <div class="bt-row"><button type="button" class="btn btn-primary" id="bt-create">🆕 部屋を作る</button></div>
        <div class="bt-row"><input id="bt-code" class="input bt-code" maxlength="5" placeholder="部屋のコード（5 文字）" autocapitalize="characters"><button type="button" class="btn" id="bt-join">入る</button></div>
      </div>`;
    bindExit();
    host.querySelector('#bt-create').addEventListener('click', () => join(newCode(), true));
    const go = () => { const c = host.querySelector('#bt-code').value.trim().toUpperCase(); if (c.length < 5) { toast('部屋のコード（5 文字）を入力してください', 'error'); return; } join(c, false); };
    host.querySelector('#bt-join').addEventListener('click', go);
    host.querySelector('#bt-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }
  function renderLobby() {
    const list = [...players.values()];
    host.innerHTML = `${head(`部屋 <span class="bt-room">${esc(room)}</span>`)}
      <p class="muted small">このコードを友達に伝えてください。${isHost ? '全員そろったら「開始」を押します。' : 'ホストが開始するのを待っています。'}</p>
      <ul class="bt-players">${list.map((p) => `<li class="${p.id === me.id ? 'me' : ''}">${p.host ? '👑 ' : ''}${esc(p.name)}</li>`).join('') || '<li class="muted">接続中…</li>'}</ul>
      ${isHost ? `<div class="bt-form">
        <div class="setup-label"><span>問題数</span></div>
        <div class="seg" id="bt-qn">${[5, 10, 20].map((n) => `<button type="button" class="${settings.qn === n ? 'on' : ''}" data-n="${n}">${n} 問</button>`).join('')}</div>
        <div class="setup-label"><span>1 問の制限時間</span></div>
        <div class="seg" id="bt-pq">${[10, 20, 30].map((n) => `<button type="button" class="${settings.perQ === n ? 'on' : ''}" data-n="${n}">${n} 秒</button>`).join('')}</div>
        <button type="button" class="btn btn-primary btn-lg" id="bt-start" ${list.length ? '' : 'disabled'}>▶ 開始（${list.length} 人）</button></div>` : ''}`;
    bindExit();
    if (isHost) {
      host.querySelectorAll('#bt-qn button').forEach((b) => b.addEventListener('click', () => { settings.qn = Number(b.dataset.n); renderLobby(); }));
      host.querySelectorAll('#bt-pq button').forEach((b) => b.addEventListener('click', () => { settings.perQ = Number(b.dataset.n); renderLobby(); }));
      host.querySelector('#bt-start').addEventListener('click', hostStart);
    }
  }
  function renderPlay() {
    const item = game.questions[game.i];
    const card = cardById(item.cardId);
    if (!card) { host.innerHTML = `${head('対戦')}<p class="muted">この問題のカードを読み込めませんでした。次の問題をお待ちください。</p>`; bindExit(); return; }
    const got = game.answers.get(game.i);
    const mine = got?.get(me.id);
    host.innerHTML = `${head(`第 ${game.i + 1} 問 / ${game.questions.length}`)}
      <div class="toolbar"><span class="counter">⏱ <b id="bt-timer">${game.perQ}</b> 秒</span><span class="muted small" id="bt-status"></span></div>
      <div class="quiz-card">${frontHtml(card, false, false)}</div>
      <div class="choices bt-choices">${item.options.map((code, i) => `<button type="button" class="choice ${mine?.choice === code ? 'picked' : ''}" data-code="${code}" ${mine ? 'disabled' : ''}><span class="key">${i + 1}</span>${flagImg(code)}<span>${esc(countryName(code))}</span></button>`).join('')}</div>`;
    bindExit();
    renderPlayStatus();
    host.querySelectorAll('.bt-choices .choice').forEach((b) => b.addEventListener('click', () => answer(b.dataset.code)));
  }
  function answer(code) {
    const got = game.answers.get(game.i);
    if (phase !== 'play' || got?.has(me.id)) return;
    host.querySelectorAll('.bt-choices .choice').forEach((b) => { b.disabled = true; b.classList.toggle('picked', b.dataset.code === code); });
    send({ t: 'ans', id: me.id, i: game.i, choice: code, ms: Math.round(performance.now() - game.t0) });
  }
  function renderPlayStatus() {
    const el = host.querySelector('#bt-status');
    if (!el || !game) return;
    const got = game.answers.get(game.i);
    el.textContent = `回答 ${[...players.keys()].filter((id) => got?.has(id)).length} / ${players.size} 人`;
  }
  function renderReveal() {
    const item = game.questions[game.i];
    const card = cardById(item.cardId);
    const got = game.answers.get(game.i) || new Map();
    const correct = new Set(card?.countries || []);
    host.innerHTML = `${head(`第 ${game.i + 1} 問 / ${game.questions.length} の答え`)}
      <div class="quiz-card">${card ? frontHtml(card, false, true) : ''}</div>
      <div class="choices bt-choices">${item.options.map((code) => {
        const who = [...got].filter(([, a]) => a.choice === code).map(([id]) => esc(names.get(id) || '?')).join('・');
        return `<div class="choice ${correct.has(code) ? 'correct' : who ? 'wrong' : ''}">${flagImg(code)}<span>${esc(countryName(code))}</span><span class="bt-who">${who}</span></div>`;
      }).join('')}</div>
      <h3 class="bt-sub">現在の順位</h3>${boardHtml()}
      <p class="muted small">${game.i + 1 < game.questions.length ? 'まもなく次の問題です…' : 'まもなく結果発表です…'}</p>`;
    bindExit();
  }
  function renderFinal() {
    host.innerHTML = `${head('結果発表')}
      <div class="bt-final">${boardHtml()}</div>
      <div class="bt-row">${isHost ? '<button type="button" class="btn btn-primary" id="bt-again">もう一度（ロビーへ）</button>' : '<span class="muted small">ホストが「もう一度」を押すと、ロビーに戻ります</span>'}</div>`;
    bindExit();
    host.querySelector('#bt-again')?.addEventListener('click', () => send({ t: 'lobby' }));
  }

  render();
  return { leave };
}
