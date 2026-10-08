// AI が、Plonkit のガイドを読んで、作るとよいカードを提案する。提案から、選んだものを、そのまま作成する（または、作成画面で編集してから作る）
// ガイド（日本語訳）の画像つきの項目に [T番号] を付けて AI に渡し、「どの項目を、どんなカードにするか」を JSON で返してもらう
import { AI_MODELS, getAiModel, setAiModel } from './assistant.js';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MAX_CONTEXT = 38000;
const MAX_CARDS = 12;

/** ガイドを、AI に渡す文章にする。戻り値: { text, tips: { 番号 → 項目 } } */
export function guideToContext(g) {
  const tips = new Map();
  const out = [];
  let n = 0;
  for (const s of g.steps) {
    out.push(`## ${s.title}`);
    for (const it of s.items) {
      if (it.k === 'div') { out.push(`### ${it.title}`); continue; }
      if (it.k !== 'tip' || !it.text?.length) continue;
      const body = it.text.map((t) => String(t).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '')).join(' ').replace(/\s+/g, ' ').trim();
      if (!body) continue;
      if (it.img) { n++; tips.set(n, it); out.push(`[T${n}] ${body}`); } else out.push(`（画像なし）${body}`);
    }
  }
  let text = out.join('\n');
  if (text.length > MAX_CONTEXT) text = `${text.slice(0, MAX_CONTEXT)}\n…（長いので、ここまで）`;
  return { text, tips };
}

// /api/ask に質問して、答えの文章（ストリーミングを、まとめて受け取る）を返す
async function askText(api, prompt, context, model = 'auto') {
  const token = await api.getAccessToken();
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], context, model }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error === 'not_configured' || res.status === 503 ? 'AI が設定されていません（GEMINI_API_KEY）' : j.message || j.error || `AI に接続できませんでした（${res.status}）`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const ev = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = ev.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      let j;
      try { j = JSON.parse(line.slice(5)); } catch { continue; }
      if (typeof j.text === 'string') text += j.text;
      if (j.error) throw new Error(j.error);
    }
  }
  return text;
}

export function parseProposals(text, tips, catNames) {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error('提案を読み取れませんでした（AI の答えが、決まった形ではありませんでした）');
  let j;
  try { j = JSON.parse(m[0]); } catch { throw new Error('提案を読み取れませんでした（途中で切れた可能性があります。もう一度試してください）'); }
  const used = new Set();
  const list = [];
  for (const c of Array.isArray(j.cards) ? j.cards : []) {
    const n = Number(String(c.tip ?? '').replace(/\D/g, ''));
    const tip = tips.get(n);
    if (!tip || used.has(n)) continue;
    used.add(n);
    const cat = catNames.find((x) => x === c.category) || catNames.find((x) => String(c.category || '').includes(x) || x.includes(String(c.category || '!'))) || '';
    list.push({ tip: n, item: tip, front: String(c.front || '').trim().slice(0, 200), back: String(c.back || '').trim().slice(0, 1200), category: cat, area: String(c.area || '').trim().slice(0, 100) });
    if (list.length >= MAX_CARDS) break;
  }
  return list;
}

/** 提案を作って、一覧の画面を出す。deps: { api, toast, host, guide, code, countryName, cats: [{id,name}], imgSrc, fetchImage(item) → Blob, createCard(fields, blob), openEditor(preset), onCreated() } */
export async function proposeCards(deps) {
  const { api, toast, host, guide, code, countryName, cats } = deps;
  const { text, tips } = guideToContext(guide);
  if (!tips.size) { toast('画像のある項目がないので、提案できません', 'error'); return; }
  const d = document.createElement('dialog');
  d.className = 'modal modal-sm modal-aicards';
  d.innerHTML = `<div class="modal-inner">
    <div class="modal-head"><h2>✨ AI のカード提案 <span class="muted small">${esc(countryName)}</span></h2><button class="icon-btn" data-x aria-label="閉じる">✕</button></div>
    <div class="aic-model-row"><label class="muted small" for="aic-model">使うモデル</label>
      <select class="select select-sm" id="aic-model" title="使うモデル（AI のチャットと共通。「自動」は、混み合っているときに別のモデルへ切り替えます）">${AI_MODELS.map(([id, label]) => `<option value="${esc(id)}" ${id === getAiModel() ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>
      <button type="button" class="btn btn-ghost btn-sm" id="aic-again" title="今のモデルで、もう一度提案する">↻ もう一度提案</button></div>
    <div class="aic-body"><p class="aic-state muted"><span class="spinner"></span> Plonkit のガイドを読んで、カードにするとよい項目を探しています…（20〜40 秒ほど）</p></div>
  </div>`;
  (host || document.body).appendChild(d);
  let closed = false;
  const close = () => { closed = true; d.close(); d.remove(); };
  d.querySelector('[data-x]').addEventListener('click', close);
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  d.showModal();
  const body = d.querySelector('.aic-body');
  const catNames = cats.map((c) => c.name);
  const prompt = `次は、${countryName}の GeoGuessr の攻略ガイド（Plonk It の日本語訳）です。画像のある項目の先頭に [T番号] が付いています。
この国を当てるための暗記カード（表面: 画像と短い説明、裏面: 見分け方の解説）にするとよい項目を、最大 ${MAX_CARDS} 個選んで、カードの案を、次の形の JSON だけで返してください（前後に説明は書かない）:
{"cards":[{"tip":番号,"front":"表面に出す短い説明（何の手がかりか。国名は書かない）","back":"裏面の解説（見分け方、似た国との違い。ガイドに書かれている内容だけ）","category":"カテゴリー名","area":"地域の補足（なければ空）"}]}
- tip は、[T番号] の数字だけ。同じ番号は 1 回だけ。
- category は、次の中から 1 つ選ぶ（合うものがなければ空）: ${catNames.join('、')}
- 国全体に共通して役立つ手がかりや、見分けやすい手がかりを優先する。ガイドにない内容は書かない。`;
  const loadingHtml = '<p class="aic-state muted"><span class="spinner"></span> Plonkit のガイドを読んで、カードにするとよい項目を探しています…（20〜40 秒ほど）</p>';
  let runId = 0;
  const run = async () => {
    const mine = ++runId;
    body.innerHTML = loadingHtml;
    try {
    const answer = await askText(api, prompt, text, getAiModel());
    if (mine !== runId) return;
    if (closed || mine !== runId) return;
    const list = parseProposals(answer, tips, catNames);
    if (!list.length) throw new Error('カードにできそうな項目が見つかりませんでした');
    body.innerHTML = `
      <p class="muted small aic-note">AI の提案です。間違いや言い過ぎがないか、確認してから作成してください。チェックしたものが作成されます。</p>
      <div class="aic-list">${list.map((p, i) => `
        <div class="aic-card" data-i="${i}">
          <label class="aic-check"><input type="checkbox" checked></label>
          <img class="aic-img" src="${esc(deps.imgSrc(p.item.img))}" alt="" loading="lazy">
          <div class="aic-fields">
            <input class="input aic-front" value="${esc(p.front)}" placeholder="表面の説明">
            <textarea class="input aic-back" rows="3" placeholder="裏面の解説">${esc(p.back)}</textarea>
            <div class="aic-row">
              <select class="select select-sm aic-cat"><option value="">カテゴリーなし</option>${cats.map((c) => `<option value="${esc(c.id)}" ${c.name === p.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
              <input class="input aic-area" value="${esc(p.area)}" placeholder="詳細エリア（任意）">
              <button type="button" class="btn btn-ghost btn-sm aic-edit" title="作成画面で、編集してから作る">✎ 編集して作る</button>
            </div>
          </div>
        </div>`).join('')}</div>
      <div class="modal-foot aic-foot">
        <span class="muted small" id="aic-count"></span><span class="grow"></span>
        <button class="btn btn-ghost" type="button" data-x>キャンセル</button>
        <button class="btn btn-primary" type="button" id="aic-make">選んだカードを作成</button>
      </div>`;
    const cards = [...body.querySelectorAll('.aic-card')];
    const fieldsOf = (el) => ({
      description: el.querySelector('.aic-front').value.trim(),
      notes: el.querySelector('.aic-back').value.trim(),
      categoryId: el.querySelector('.aic-cat').value || null,
      area: el.querySelector('.aic-area').value.trim(),
    });
    const count = () => { const n = cards.filter((c) => c.querySelector('input[type=checkbox]').checked).length; body.querySelector('#aic-count').textContent = `${n} 件を作成`; body.querySelector('#aic-make').disabled = !n; };
    cards.forEach((c) => c.querySelector('input[type=checkbox]').addEventListener('change', count));
    count();
    body.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', close));
    body.querySelectorAll('.aic-edit').forEach((b) => b.addEventListener('click', async () => {
      const el = b.closest('.aic-card');
      const p = list[Number(el.dataset.i)];
      b.disabled = true;
      try { const blob = await deps.fetchImage(p.item); close(); deps.openEditor({ countries: [code], blob, ...fieldsOf(el) }); } catch (ex) { toast(`画像を取り込めませんでした: ${ex.message}`, 'error'); b.disabled = false; }
    }));
    body.querySelector('#aic-make').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      let ok = 0; let ng = 0;
      for (const el of cards) {
        if (!el.querySelector('input[type=checkbox]').checked) continue;
        const p = list[Number(el.dataset.i)];
        const f = fieldsOf(el);
        btn.textContent = `作成中… ${ok + ng + 1}`;
        try {
          const blob = await deps.fetchImage(p.item);
          await deps.createCard({ description: f.description, countries: [code], area: f.area, notes: f.notes, category_id: f.categoryId, related: [], sv_ids: [], places: [] }, blob);
          ok++;
          el.classList.add('is-done');
        } catch { ng++; el.classList.add('is-ng'); }
      }
      toast(ng ? `${ok} 件を作成しました（${ng} 件は、作成できませんでした）` : `${ok} 件のカードを作成しました`, ng ? 'error' : undefined);
      await deps.onCreated?.();
      if (!ng) close(); else { btn.textContent = '選んだカードを作成'; btn.disabled = false; }
    });
  } catch (ex) {
    if (closed || mine !== runId) return;
    body.innerHTML = `<p class="aic-err">${esc(ex.message || '提案できませんでした')}</p><div class="modal-foot"><span class="grow"></span><button class="btn" type="button" data-x>閉じる</button></div>`;
    body.querySelector('[data-x]').addEventListener('click', close);
  }
  };
  // モデルを変えたら、そのモデルで、もう一度提案する（「もう一度提案」でも）
  d.querySelector('#aic-model').addEventListener('change', (e) => { setAiModel(e.target.value); run(); });
  d.querySelector('#aic-again').addEventListener('click', () => run());
  run();
}
