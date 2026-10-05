// クイズのリアルタイム対戦（部屋のコードで集まり、同じ問題を同時に解いて得点を競う）
// 出題内容: カード / 参考写真 / 国の特徴 / ストリートビュー。回答方式: 4 択・入力・地図・ピン（出題内容によって使えるもの）
// 通信は Supabase Realtime の Broadcast / Presence（テーブルは使わない）。デモモードでは同じブラウザの別タブどうしで試せる
// ホストが問題を出す合図（q）と答え合わせ（reveal）を送り、得点は各自が出して（ans）全員で足し合わせる
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 5 }, () => ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)]).join('');
const newId = () => Math.random().toString(36).slice(2, 10);
const NAME_KEY = 'geo-cards-battle-name';
const REVEAL_MS = 6000; // 答え合わせを見せる時間
const medal = (i) => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
const KINDS = [['cards', '🃏 カード'], ['photo', '📷 参考写真'], ['fact', '🗺 国の特徴'], ['sv', '🧍 ストリートビュー']];
const MODES = { choice: '4 択', input: '入力', map: '地図で選ぶ', pin: '場所をピン' };
const modesOf = (kind) => (kind === 'cards' ? ['choice', 'input', 'map'] : kind === 'fact' ? ['choice'] : ['choice', 'input', 'map', 'pin']);
const bonus = (ms, limit) => 1 - Math.min(1, ms / (limit * 1000)); // 速いほど 1 に近い

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
  const cfg = { kind: 'cards', mode: 'choice', topic: 'chevron', qn: 10, perQ: 20 };
  const alive = () => host.isConnected;
  const clearTimers = () => { clearInterval(tick); tick = null; timers.forEach(clearTimeout); timers = []; };
  const later = (ms, fn) => { timers.push(setTimeout(() => { if (alive()) fn(); }, ms)); };
  function leave() { clearTimers(); ctx.setSvHide(false); try { ch?.leave(); } catch { /* 無視 */ } ch = null; }
  const send = (m) => ch?.send(m);

  async function join(code, asHost) {
    me.name = (host.querySelector('#bt-name')?.value || me.name || '').trim().slice(0, 16) || `プレイヤー${Math.floor(Math.random() * 90 + 10)}`;
    try { localStorage.setItem(NAME_KEY, me.name); } catch { /* 無視 */ }
    room = code;
    isHost = asHost;
    names.set(me.id, me.name);
    try {
      ch = await api.battleChannel(room, { id: me.id, name: me.name, host: asHost }, {
        msg: onMsg,
        presence: (list) => { players = new Map(list.map((p) => [p.id, p])); list.forEach((p) => names.set(p.id, p.name)); if (!alive()) return; if (phase === 'lobby') renderLobby(); else if (phase === 'play') renderPlayStatus(); },
      });
    } catch (e) { toast(e.message || '接続できませんでした', 'error'); return; }
    phase = 'lobby';
    renderLobby();
    if (!asHost) {
      later(2500, () => { if (phase === 'lobby' && ![...players.values()].some((p) => p.host)) { toast('その部屋は見つかりませんでした。コードを確認してください', 'error'); leave(); phase = 'entry'; renderEntry(); } });
    }
  }

  // ---- 進行（ホスト） ----
  async function hostStart() {
    if (building) return;
    building = true;
    renderLobby();
    try {
      const questions = await ctx.buildQuestions(cfg);
      if (questions.length < 3) { toast('出題できる問題が足りません。地域やカテゴリーの条件を広げてください（クイズ設定）', 'error'); return; }
      send({ t: 'start', perQ: cfg.perQ, questions });
      later(2000, () => send({ t: 'q', i: 0 }));
    } catch (e) { toast(`問題を作れませんでした（${e.message}）`, 'error'); } finally { building = false; if (phase === 'lobby') renderLobby(); }
  }
  const hostOpened = (i) => later(game.perQ * 1000 + 1500, () => { if (game && game.i === i && phase === 'play') send({ t: 'reveal', i }); });
  const hostRevealed = (i) => later(REVEAL_MS, () => { if (game && game.i === i) send(i + 1 < game.questions.length ? { t: 'q', i: i + 1 } : { t: 'end' }); });
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
      host.innerHTML = '<p class="bt-wait">問題を準備しています…</p>';
      await ctx.prepare(m.questions);
      game = { questions: m.questions, perQ: m.perQ, i: -1, answers: new Map(), scores: new Map(), done: new Set(), t0: 0 };
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
  function submit({ res, pts, label }) {
    const got = game?.answers.get(game.i);
    if (phase !== 'play' || got?.has(me.id)) return;
    host.querySelectorAll('.bt-choices .choice, #bt-send, #bt-guess, #bt-input').forEach((b) => { b.disabled = true; });
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
  const head = (title) => `<div class="bt-head"><h2>👥 ${title}</h2><button type="button" class="btn btn-ghost btn-sm" id="bt-exit">${phase === 'entry' ? '← 戻る' : '退出'}</button></div>`;
  const bindExit = () => host.querySelector('#bt-exit')?.addEventListener('click', () => { leave(); onExit(); });

  function renderEntry() {
    if (!alive()) return;
    host.innerHTML = `${head('リアルタイム対戦')}
      <p class="muted small">部屋を作って、表示されたコードを友達に伝えます。同じコードを入力した人と、同じ問題を同時に解いて、速さと正解で得点を競います。出題内容と回答方式は、ホストが選びます。デモモードでは、同じブラウザの別タブで試せます。</p>
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
  const segHtml = (id, opts, cur) => `<div class="seg ${opts.length > 4 ? 'seg-wrap' : ''}" id="${id}">${opts.map(([v, label]) => `<button type="button" class="${cur === v ? 'on' : ''}" data-v="${v}">${label}</button>`).join('')}</div>`;
  function renderLobby() {
    if (!alive()) return;
    const list = [...players.values()];
    if (!modesOf(cfg.kind).includes(cfg.mode)) cfg.mode = modesOf(cfg.kind)[0];
    host.innerHTML = `${head(`部屋 <span class="bt-room">${esc(room)}</span>`)}
      <p class="muted small">このコードを友達に伝えてください。${isHost ? '全員そろったら「開始」を押します。' : 'ホストが開始するのを待っています。'}</p>
      <ul class="bt-players">${list.map((p) => `<li class="${p.id === me.id ? 'me' : ''}">${p.host ? '👑 ' : ''}${esc(p.name)}</li>`).join('') || '<li class="muted">接続中…</li>'}</ul>
      ${isHost ? `<div class="bt-form">
        <div class="setup-label"><span>出題内容</span></div>${segHtml('bt-kind', KINDS, cfg.kind)}
        ${cfg.kind === 'fact' ? `<div class="setup-label"><span>国の特徴の種類</span></div>${segHtml('bt-topic', ctx.factTopics.map((t) => [t.id, `${t.icon} ${esc(t.name)}`]), cfg.topic)}` : `<div class="setup-label"><span>回答方式</span></div>${segHtml('bt-mode', modesOf(cfg.kind).map((m) => [m, MODES[m]]), cfg.mode)}`}
        <div class="setup-label"><span>問題数</span></div>${segHtml('bt-qn', [5, 10, 20].map((n) => [n, `${n} 問`]), cfg.qn)}
        <div class="setup-label"><span>1 問の制限時間</span></div>${segHtml('bt-pq', [20, 30, 45, 60].map((n) => [n, `${n} 秒`]), cfg.perQ)}
        <p class="muted small">出題の範囲（地域・カテゴリー）は、クイズ設定の内容が使われます。</p>
        <button type="button" class="btn btn-primary btn-lg" id="bt-start" ${list.length && !building ? '' : 'disabled'}>${building ? '問題を作成中…' : `▶ 開始（${list.length} 人）`}</button></div>` : ''}`;
    bindExit();
    if (!isHost) return;
    const pick = (id, key, num) => host.querySelectorAll(`#${id} button`).forEach((b) => b.addEventListener('click', () => { cfg[key] = num ? Number(b.dataset.v) : b.dataset.v; renderLobby(); }));
    pick('bt-kind', 'kind'); pick('bt-mode', 'mode'); pick('bt-topic', 'topic'); pick('bt-qn', 'qn', true); pick('bt-pq', 'perQ', true);
    host.querySelector('#bt-start').addEventListener('click', hostStart);
  }

  function renderPlay() {
    const Q = game.questions[game.i];
    const top = `${head(`第 ${game.i + 1} 問 / ${game.questions.length}`)}
      <div class="toolbar"><span class="counter">⏱ <b id="bt-timer">${game.perQ}</b> 秒</span><span class="muted small" id="bt-status"></span><span class="muted small" id="bt-mine"></span></div>`;
    ctx.setSvHide(true);
    if (Q.k === 'fact') {
      const item = Q.item;
      host.innerHTML = `${top}<div class="quiz-card fact-card"><img class="fact-flag" src="${esc(ctx.flagUrl(item.code))}" alt=""><div class="fact-country">${esc(countryName(item.code))}</div></div>
        <p class="quiz-prompt">この国の${esc(Q.topicIcon)} ${esc(Q.topicName)}は？</p>
        <div class="choices bt-choices fact-choices">${item.options.map((o, i) => `<button type="button" class="choice" data-key="${esc(o.key)}"><span class="kbd">${i + 1}</span>${o.swatch}<span>${esc(o.label)}</span></button>`).join('')}</div>`;
      bindExit();
      host.querySelectorAll('.bt-choices .choice').forEach((b) => b.addEventListener('click', () => {
        const res = b.dataset.key === item.answer ? 'ok' : 'ng';
        submit({ res, pts: scoreOf(res), label: item.options.find((o) => o.key === b.dataset.key)?.label || '' });
      }));
      renderPlayStatus();
      return;
    }
    const card = ctx.cardFor(Q);
    if (!card) { host.innerHTML = `${top}<p class="muted">この問題のカードを読み込めませんでした。次の問題をお待ちください。</p>`; bindExit(); return; }
    const front = `<div class="quiz-card">${frontHtml(card, false, false)}</div>`;
    if (Q.mode === 'choice') {
      host.innerHTML = `${top}${front}<div class="choices bt-choices">${Q.options.map((code, i) => `<button type="button" class="choice" data-code="${code}"><span class="key">${i + 1}</span>${flagImg(code)}<span>${esc(countryName(code))}</span></button>`).join('')}</div>`;
      bindExit();
      host.querySelectorAll('.bt-choices .choice').forEach((b) => b.addEventListener('click', () => {
        const res = card.countries.includes(b.dataset.code) ? 'ok' : 'ng';
        submit({ res, pts: scoreOf(res), label: countryName(b.dataset.code) });
      }));
    } else if (Q.mode === 'input') {
      const need = card.countries.length;
      const draft = [];
      host.innerHTML = `${top}${front}<div class="bt-input-row"><div class="bt-chips" id="bt-chips"></div>
        <input type="text" id="bt-input" class="input" list="country-list" placeholder="${need > 1 ? `国名を入力して Enter で追加（${need} か国）` : '国名を入力して Enter（例: ポーランド / Poland）'}" autocomplete="off">
        <button type="button" class="btn btn-primary" id="bt-send">回答</button></div>`;
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
      host.innerHTML = `${top}<div class="qm-layout qm-float bt-qm"><div class="quiz-card">${frontHtml(card, false, false)}</div>
        <div class="qm-side"><div class="quiz-map" id="bt-map"><div class="map-loading">地図を読み込み中…</div></div>
        <p class="quiz-prompt">${Q.mode === 'map' ? '答えの国を、地図でクリック' : '場所を地図でクリックしてピンを置き、「回答」を押してください'}</p>
        ${Q.mode === 'pin' ? '<button class="btn btn-primary qm-guess" id="bt-guess" type="button" disabled>📍 この場所で回答</button>' : ''}</div></div>`;
      bindExit();
      const at = game.i;
      if (Q.mode === 'map') {
        ctx.mountQuizMap(host.querySelector('#bt-map'), { answers: card.countries, answered: null, qid: `bt${at}`, animate: false, onPick: (code) => {
          if (game.i !== at) return;
          const r = ctx.judge(card, 'map', [code]).result;
          submit({ res: r, pts: scoreOf(r), label: countryName(code) });
        } }).then(() => host.querySelector('#bt-map .map-loading')?.remove()).catch(() => {});
      } else {
        let pending = null;
        ctx.mountPinMap(host.querySelector('#bt-map'), { answer: [card.lat, card.lng], qid: `bt${at}`, animate: false, onPlace: (g) => { pending = g; const b = host.querySelector('#bt-guess'); if (b) b.disabled = false; } })
          .then(() => host.querySelector('#bt-map .map-loading')?.remove()).catch(() => {});
        host.querySelector('#bt-guess').addEventListener('click', () => {
          if (!pending || game.i !== at) return;
          const km = ctx.distanceBetween(pending, [card.lat, card.lng]);
          const pts = Math.round(1000 * Math.exp(-km / 1500) * (0.8 + 0.2 * bonus(msNow(), game.perQ)));
          submit({ res: km <= 150 ? 'ok' : km <= 750 ? 'partial' : 'ng', pts, label: `約 ${Math.round(km).toLocaleString()} km` });
        });
      }
    }
    renderPlayStatus();
  }
  function renderPlayStatus() {
    const el = host.querySelector('#bt-status');
    if (!el || !game) return;
    const got = game.answers.get(game.i);
    el.textContent = `回答 ${[...players.keys()].filter((id) => got?.has(id)).length} / ${players.size} 人`;
  }

  function renderReveal() {
    const Q = game.questions[game.i];
    const got = game.answers.get(game.i) || new Map();
    ctx.setSvHide(false);
    let body;
    if (Q.k === 'fact') {
      const item = Q.item;
      body = `<div class="quiz-card fact-card"><img class="fact-flag" src="${esc(ctx.flagUrl(item.code))}" alt=""><div class="fact-country">${esc(countryName(item.code))}</div></div>
        <div class="choices fact-choices bt-choices">${item.options.map((o) => `<div class="choice ${o.key === item.answer ? 'correct' : 'dim'}">${o.swatch}<span>${esc(o.label)}</span></div>`).join('')}</div>
        <div class="pfact">${ctx.factPanelHtml(Q.topic, item.code)}</div>`;
    } else {
      const card = ctx.cardFor(Q);
      body = `<div class="quiz-card">${card ? frontHtml(card, false, true) : ''}</div>${card ? `<div class="bt-answer">${ctx.answerHtml(card)}${ctx.cardInfoHtml(card)}</div>` : ''}`;
    }
    const rows = board().map((p) => {
      const a = got.get(p.id);
      return `<li class="${p.id === me.id ? 'me' : ''}"><span class="bt-pname">${esc(p.name)}</span><span class="bt-res res-${a?.res || 'ng'}">${a ? { ok: '○', partial: '△', ng: '✗' }[a.res] : '－'}</span><span class="bt-label">${a ? esc(a.label || '') : '未回答'}</span><b class="bt-score">+${(a?.pts || 0).toLocaleString()}</b></li>`;
    }).join('');
    host.innerHTML = `${head(`第 ${game.i + 1} 問 / ${game.questions.length} の答え`)}${body}
      <h3 class="bt-sub">この問題の結果</h3><ul class="bt-board bt-results">${rows}</ul>
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

  renderEntry();
  return { leave };
}
