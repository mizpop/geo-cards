// AI が、Plonkit のガイドを読んで、作るとよいカードを提案する。提案から、選んだものを、そのまま作成する（または、作成画面で編集してから作る）
// ガイド（日本語訳）の画像つきの項目に [T番号] を付けて AI に渡し、「どの項目を、どんなカードにするか」を JSON で返してもらう
import { AI_MODELS, getAiModel, setAiModel } from './assistant.js';
import { parseStreetView, isMapImage } from './plonkit.js';
import { removeMaps, detectMapRegions, eraseRegions } from './mapdetect.js';
const AUTOMAP_KEY = 'geo-aicards-automap';
const getAutoMap = () => { try { return localStorage.getItem(AUTOMAP_KEY) !== '0'; } catch { return true; } };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MAX_CONTEXT = 140000; // ガイドは、長くても 2 万文字ほど。全文を渡す（途中で切らない）
const COUNTS = [10, 15, 20, 30, 50, 80, 100];
const MINSCORE_KEY = 'geo-aicards-minscore';
const SCORE_OPTS = [[5, '★5 のみ（決め手になるものだけ）'], [4, '★4 以上（初期）'], [3, '★3 以上'], [1, 'すべて']];
const getMinScore = () => { try { const v = Number(localStorage.getItem(MINSCORE_KEY)); return SCORE_OPTS.some(([n]) => n === v) ? v : 4; } catch { return 4; } };
const COUNT_KEY = 'geo-aicards-count';
const getCount = () => { try { const v = Number(localStorage.getItem(COUNT_KEY)); return COUNTS.includes(v) ? v : 20; } catch { return 20; } };

const SHORT_SV = /^https?:\/\/(goo\.gl\/maps\/|maps\.app\.goo\.gl\/)/;
const isSvUrl = (u) => !!u && (SHORT_SV.test(u) || !!parseStreetView(u));
/** その項目の、ストリートビューのリンク（画像のリンク → 本文のリンクの順）。なければ '' */
export function svLinkOf(item) {
  if (isSvUrl(item.link)) return item.link;
  for (const t of item.text || []) for (const m of String(t).matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) if (isSvUrl(m[1])) return m[1];
  return '';
}
// 文章から、AI がうっかり書いた [T10] などの印を消す
const cleanText = (t) => String(t || '').replace(/[\[［【(（]\s*T\s*\d+\s*[\]］】)）]/g, '').replace(/\bT\d{1,3}\b/g, '').replace(/\s{2,}/g, ' ').replace(/\s+([、。,.])/g, '$1').trim();

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
      if (it.img && !isMapImage(it)) { n++; tips.set(n, it); out.push(`[T${n}] ${body}`); } else out.push(`（${it.img ? '地図の画像' : '画像なし'}・カードにしない）${body}`); // 地図の画像の項目には、番号を付けない（カードにしない）
    }
  }
  let text = out.join('\n');
  if (text.length > MAX_CONTEXT) text = `${text.slice(0, MAX_CONTEXT)}\n…（長いので、ここまで）`; // 実際には、ほぼ、ここには来ない
  return { text, tips };
}

// /api/ask に質問して、答えの文章（ストリーミングを、まとめて受け取る）を返す
async function askText(api, prompt, context, model = 'auto', maxTokens = 12000) { // 答えの長さの上限。カード 1 件に、約 300 トークン
  const token = await api.getAccessToken();
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], context, model, maxTokens }),
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

// ---- 提案の保存（国ごと。閉じて、また開いても、前回の提案が残る）----
const cacheKey = (code) => `geo-aicards-v1:${code}`;
const loadCache = (code, sig) => { try { const v = JSON.parse(localStorage.getItem(cacheKey(code))); return v && v.sig === sig && Array.isArray(v.items) ? v : null; } catch { return null; } };
let cacheCtx = { code: '', sig: '' };
function saveCache(items, meta) { try { localStorage.setItem(cacheKey(cacheCtx.code), JSON.stringify({ sig: cacheCtx.sig, at: meta.at, model: meta.model, items })); } catch { /* 保存できなくても使える */ } }

// JSON が途中で切れていたら、できあがっているカードだけを拾う
function salvage(text) {
  const out = [];
  for (const m of text.matchAll(/\{[^{}]*"tip"[^{}]*\}/g)) { try { out.push(JSON.parse(m[0])); } catch { /* 途中のものは捨てる */ } }
  return out;
}
export function parseProposals(text, tips, catNames, max = 20) {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error('提案を読み取れませんでした（AI の答えが、決まった形ではありませんでした）');
  let j;
  try { j = JSON.parse(m[0]); } catch { const part = salvage(text); if (!part.length) throw new Error('提案を読み取れませんでした（途中で切れた可能性があります。もう一度試してください）'); j = { cards: part }; }
  const used = new Set();
  const list = [];
  for (const c of Array.isArray(j.cards) ? j.cards : []) {
    const n = Number(String(c.tip ?? '').replace(/\D/g, ''));
    const tip = tips.get(n);
    if (!tip || used.has(n)) continue;
    used.add(n);
    const cat = catNames.find((x) => x === c.category) || catNames.find((x) => String(c.category || '').includes(x) || x.includes(String(c.category || '!'))) || '';
    const sv = svLinkOf(tip);
    const alsoRaw = (Array.isArray(c.also) ? c.also : []).map((x) => cleanText(x)).filter(Boolean).slice(0, 12);
    const score = Math.max(1, Math.min(5, Math.round(Number(c.score)) || 3));
    list.push({ tip: n, item: tip, alsoRaw, score, front: cleanText(c.front).slice(0, 200), back: cleanText(c.back).slice(0, 1200), category: cat, area: cleanText(c.area).slice(0, 100), sv, svOn: !!sv });
    if (list.length >= max) break;
  }
  return list;
}

/** 提案を作って、一覧の画面を出す。deps: { api, toast, host, guide, code, countryName, cats: [{id,name}], imgSrc, fetchImage(item) → Blob, createCard(fields, blob), openEditor(preset), onCreated() } */
export async function proposeCards(deps) {
  const { api, toast, host, guide, code, countryName, cats } = deps;
  const { text, tips } = guideToContext(guide);
  cacheCtx = { code, sig: `${tips.size}:${text.length}` }; // ガイドが変わったら、前回の提案は使わない
  if (!tips.size) { toast('画像のある項目がないので、提案できません', 'error'); return; }
  const d = document.createElement('dialog');
  d.className = 'modal modal-sm modal-aicards';
  d.innerHTML = `<div class="modal-inner">
    <div class="modal-head"><h2>✨ AI のカード提案 <span class="muted small">${esc(countryName)}</span></h2><button class="icon-btn" data-x aria-label="閉じる">✕</button></div>
    <div class="aic-model-row"><label class="muted small" for="aic-model">使うモデル</label>
      <select class="select select-sm" id="aic-model" title="使うモデル（AI のチャットと共通。「自動」は、混み合っているときに別のモデルへ切り替えます）">${AI_MODELS.map(([id, label]) => `<option value="${esc(id)}" ${id === getAiModel() ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>
      <label class="muted small" for="aic-count-sel">数</label>
      <select class="select select-sm" id="aic-count-sel" title="提案してもらうカードの数（上限）">${COUNTS.map((n) => `<option value="${n}" ${n === getCount() ? 'selected' : ''}>最大 ${n} 件</option>`).join('')}</select>
      <label class="muted small" for="aic-minscore">絞り込み</label>
      <select class="select select-sm" id="aic-minscore" title="AI が付けた「この国だと特定するのに役立つ度」で絞り込みます。多くの国で使われている手がかり（シェブロンなど）は、低くなります">${SCORE_OPTS.map(([n, label]) => `<option value="${n}" ${n === getMinScore() ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>
      <label class="aic-auto small" title="作るときに、画像に地図（挿入地図・位置図など）が映っていたら、軽量で画像を読める AI（Gemini Flash-Lite → Cloudflare の Llama 4 Scout）が範囲を見つけて、黒で塗りつぶします"><input type="checkbox" id="aic-automap" ${getAutoMap() ? 'checked' : ''}> 🗺 画像に映った地図を、自動で消す</label>
      <button type="button" class="btn btn-ghost btn-sm" id="aic-again" title="今のモデル・数で、もう一度提案する">↻ もう一度提案</button></div>
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
  // 「他の国」の欄の国名（、や , で区切る）を、国コードにする。この国は、いつも、先頭に入れる。読めなかった名前は、unknown に
  const countriesOf = (text) => {
    const codes = [code]; const unknown = [];
    for (const n of String(text || '').split(/[、,，\n]/).map((x) => x.trim()).filter(Boolean)) { const c = deps.resolveCountry?.(n); if (c && !codes.includes(c)) codes.push(c); else if (!c) unknown.push(n); }
    return { codes, unknown };
  };
  const prompt = () => `次は、${countryName}の GeoGuessr の攻略ガイド（Plonk It の日本語訳）の全文です。画像のある項目の先頭に [T番号] が付いています。
この国だと特定するのに、大きく役立つ手がかりだけを、暗記カード（表面: 画像と短い説明、裏面: 見分け方の解説）にします。そうした項目を、ガイドの最初から最後まで、全体を見て、偏りなく選び、最大 ${getCount()} 個、カードの案を、次の形の JSON だけで返してください（前後に説明は書かない）:
{"cards":[{"tip":番号,"front":"表面に出す短い説明（何の手がかりか。国名は書かない）","back":"裏面の解説（見分け方、似た国との違い。ガイドに書かれている内容だけ）","category":"カテゴリー名","area":"地域の補足（なければ空）","also":["DE","FR"],"score":4}]}
- score は、その手がかりが、この国だと特定するのに、どれだけ役立つかを、1〜5 の整数で（5: これが見えれば、ほぼ、この国だと決まる / 4: 候補が数か国に絞れる / 3: 地域が絞れる程度 / 2: 多くの国で見られる / 1: ほとんど役に立たない）。多くの国で使われている手がかり（シェブロン・一般的な標識・よくある植生・ありふれた建物など）は、その国だけのものではないので、2 以下にする。本文に「ほかの国でも使われる」とあれば、同様に低くする。
- also は、その項目の本文に、「全く同じものが、ほかの国にもある」と、はっきり書かれているときだけ、その国の国コード（ISO 3166-1 の 2 文字の大文字。例: ドイツ DE・フランス FR・イギリス GB・アメリカ US。${countryName}は入れない）を並べる。国名では書かない。推測・似ているだけ・「少し違う」ものは入れない。書かれていなければ、空の配列にする。
- tip は、[T番号] の数字だけ。同じ番号は 1 回だけ。front・back・area の文章には、[T10] のような番号や印は、書かない。
- category は、次の中から 1 つ選ぶ（合うものがなければ空）: ${catNames.join('、')}
- [T番号] が付いていない項目（画像なし・地図の画像）は、選ばない。画像が地図（地図・カバレッジ・地域区分・位置図など）だと思われる項目も、選ばない。
- ガイドの前半だけに偏らず、後半の項目も選ぶ。国全体に共通して役立つ手がかりや、見分けやすい手がかりを優先する。ガイドにない内容は書かない。`;
  // 提案の一覧を描く（AI の答え・前回の保存、どちらからでも）
  let curList = null; let curMeta = null;
  const renderList = (list, meta) => {
    curList = list; curMeta = meta;
    body.innerHTML = `
      <p class="muted small aic-hidden">${(() => { const hid = list.filter((p) => p.score < getMinScore() && !p.done).length; return hid ? `AI の提案 ${list.length} 件のうち、国の特定に役立つ度が低い ${hid} 件は、絞り込みで隠しています（「絞り込み」で変えられます）。` : ''; })()}</p>
      <p class="muted small aic-note">${meta.cached ? `前回の提案（${esc(new Date(meta.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}・${esc((AI_MODELS.find(([id]) => id === meta.model) || [0, meta.model])[1])}）を、そのまま表示しています。` : 'AI の提案です。'}間違いや言い過ぎがないか、確認してから作成してください。チェックしたものが作成されます。内容は、閉じても、覚えておきます（「もう一度提案」で、作り直せます）。</p>
      <div class="aic-list">${list.map((p, i) => [p, i]).filter(([p]) => p.score >= getMinScore() || p.done).map(([p, i]) => `
        <div class="aic-card ${p.done ? 'is-done' : ''}" data-i="${i}">
          <label class="aic-check"><input type="checkbox" ${p.checked && !p.done ? 'checked' : ''} ${p.done ? 'disabled' : ''}></label>
          <div class="aic-imgbox"><img class="aic-img" src="${esc(p.blob ? URL.createObjectURL(p.blob) : deps.imgSrc(p.item.img))}" alt="" loading="lazy"><span class="aic-mapstate small muted"></span><button type="button" class="btn btn-ghost btn-sm aic-imgmap" title="軽量な AI が、画像に映った地図を見つけて、消します">✨ 地図を消す</button><button type="button" class="btn btn-ghost btn-sm aic-imgedit" title="画像を編集する（地図が映り込んだ部分を消す・ぼかす・トリミングなど）">🖌 画像を編集</button></div>
          <div class="aic-fields">
            <div class="aic-score small" title="この国だと特定するのに、どれだけ役立つか（AI の判断）">国の特定に役立つ度: <b>${'★'.repeat(p.score)}${'☆'.repeat(5 - p.score)}</b></div>
            <input class="input aic-front" value="${esc(p.front)}" placeholder="表面の説明">
            <label class="aic-also small"><span class="muted">他の国（ガイドに「同じものがある」とある国。カードの国に足します）</span><input class="input aic-countries" value="${esc(p.alsoText || '')}" placeholder="例: ドイツ、フランス（なければ空）"></label>
            <textarea class="input aic-back" rows="3" placeholder="裏面の解説">${esc(p.back)}</textarea>
            <div class="aic-row">
              <select class="select select-sm aic-cat"><option value="">カテゴリーなし</option>${cats.map((c) => `<option value="${esc(c.id)}" ${c.id === p.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
              <input class="input aic-area" value="${esc(p.area)}" placeholder="詳細エリア（任意）">
              <button type="button" class="btn btn-ghost btn-sm aic-edit" title="作成画面で、編集してから作る">✎ 編集して作る</button>
            </div>
            ${p.sv ? `<label class="aic-svrow small"><input type="checkbox" class="aic-sv" ${p.svOn ? 'checked' : ''}> 📍 ガイドの場所のストリートビューも、保存して、関連付ける</label>` : ''}
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
      sv: !!el.querySelector('.aic-sv')?.checked,
      alsoText: el.querySelector('.aic-countries').value.trim(),
    });
    const count = () => { const n = cards.filter((c) => c.querySelector('.aic-check input').checked).length; body.querySelector('#aic-count').textContent = `${n} 件を作成`; body.querySelector('#aic-make').disabled = !n; };
    cards.forEach((c) => c.querySelector('.aic-check input').addEventListener('change', count));
    count();
    body.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', close));
    // 地図を自動で消す（カードごと）。見つからなければ、そのまま
    body.querySelectorAll('.aic-imgmap').forEach((b) => b.addEventListener('click', async () => {
      const el = b.closest('.aic-card');
      const p = list[Number(el.dataset.i)];
      b.disabled = true; const label = b.textContent; b.textContent = '探しています…';
      try {
        const r = await removeMaps(api, p.blob || await deps.fetchImage(p.item));
        p.mapChecked = true;
        if (r.found) { p.blob = r.blob; el.querySelector('.aic-img').src = URL.createObjectURL(r.blob); b.textContent = `✔ 地図を消しました（${r.found} か所）`; toast(`地図を ${r.found} か所、消しました`); } else { b.textContent = '地図は見つかりませんでした'; toast('地図は見つかりませんでした'); }
      } catch (ex) { b.textContent = label; toast(`地図を探せませんでした: ${ex.message}`, 'error'); }
      b.disabled = false;
    }));
    // 画像の一部（地図の映り込みなど）を、消す・ぼかす・トリミングする。編集した画像は、このウィンドウを閉じるまで、使われる
    body.querySelectorAll('.aic-imgedit').forEach((b) => b.addEventListener('click', async () => {
      const el = b.closest('.aic-card');
      const p = list[Number(el.dataset.i)];
      b.disabled = true;
      try {
        const base = await deps.fetchImage(p.item); // 元の画像から編集する（AI が塗りつぶした範囲も、図形として、動かしたり消したりできる）
        const url = URL.createObjectURL(base);
        const extra = p.edit ? { shapes: p.edit.shapes, crop: p.edit.crop } : { regions: Array.isArray(p.mapRegions) ? p.mapRegions : null };
        const out = await deps.editImage(url, d, extra);
        URL.revokeObjectURL(url);
        if (out) {
          p.edit = { shapes: out.shapes, crop: out.crop }; p.mapChecked = true; p.mapRegions = out.erased;
          p.blob = out.image || null;
          el.querySelector('.aic-img').src = p.blob ? URL.createObjectURL(p.blob) : deps.imgSrc(p.item.img);
          b.textContent = p.blob ? '🖌 編集済み' : '🖌 画像を編集';
          const st = el.querySelector('.aic-mapstate'); if (st) st.textContent = p.blob ? (p.mapRegions?.length ? `✔ 地図を消しました（${p.mapRegions.length} か所）` : '') : '';
          persistNow?.();
        }
      } catch (ex) { toast(`画像を編集できませんでした: ${ex.message}`, 'error'); }
      b.disabled = false;
    }));
    body.querySelectorAll('.aic-edit').forEach((b) => b.addEventListener('click', async () => {
      const el = b.closest('.aic-card');
      const p = list[Number(el.dataset.i)];
      b.disabled = true;
      try { const f = fieldsOf(el); const blob = p.blob || await deps.fetchImage(p.item); const svId = f.sv && p.sv ? await deps.addSv(p.sv).catch(() => null) : null; close(); deps.openEditor({ countries: countriesOf(f.alsoText).codes, blob, ...f, svIds: svId ? [svId] : [] }); } catch (ex) { toast(`画像を取り込めませんでした: ${ex.message}`, 'error'); b.disabled = false; }
    }));
    body.querySelector('#aic-make').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      let ok = 0; let ng = 0; let svFail = 0; let mapsRemoved = 0; let mapFail = 0; let unknown = 0;
      const autoMap = body.closest('dialog').querySelector('#aic-automap').checked;
      try { localStorage.setItem(AUTOMAP_KEY, autoMap ? '1' : '0'); } catch { /* 保存できなくても使える */ }
      for (const el of cards) {
        if (!el.querySelector('.aic-check input').checked) continue;
        const p = list[Number(el.dataset.i)];
        const f = fieldsOf(el);
        btn.textContent = `作成中… ${ok + ng + 1}`;
        try {
          let blob = p.blob || await deps.fetchImage(p.item);
          if (autoMap && !p.mapChecked) { // 作るときに、地図が映っていたら、自動で消す（軽量な AI。失敗しても、元の画像で作る）
            btn.textContent = `地図を確認中… ${ok + ng + 1}`;
            try { const r = await removeMaps(api, blob); p.mapChecked = true; if (r.found) { blob = r.blob; mapsRemoved++; } } catch { mapFail++; }
          }
          const svId = f.sv && p.sv ? await deps.addSv(p.sv).catch(() => null) : null; // ストリートビューは、取れなくても、カードは作る
          if (f.sv && p.sv && !svId) svFail++;
          const cs = countriesOf(f.alsoText); unknown += cs.unknown.length;
          await deps.createCard({ description: f.description, countries: cs.codes, area: f.area, notes: f.notes, category_id: f.categoryId, related: [], sv_ids: svId ? [svId] : [], places: [] }, blob);
          ok++;
          p.done = true;
          el.classList.add('is-done');
        } catch { ng++; el.classList.add('is-ng'); }
      }
      toast((ng ? `${ok} 件を作成しました（${ng} 件は、作成できませんでした）` : `${ok} 件のカードを作成しました`) + (svFail ? `（${svFail} 件は、ストリートビューを取り込めませんでした）` : '') + (mapsRemoved ? `（${mapsRemoved} 件は、地図を消しました）` : '') + (mapFail ? `（${mapFail} 件は、地図を探せませんでした）` : '') + (unknown ? `（国名として読めなかった ${unknown} か所は、除きました）` : ''), ng ? 'error' : undefined);
      persist();
      await deps.onCreated?.();
      if (!ng) close(); else { btn.textContent = '選んだカードを作成'; btn.disabled = false; }
    });
    const persist = () => saveCache(list.map((p, i) => { const el = body.querySelector(`.aic-card[data-i="${i}"]`); const f = el ? { front: el.querySelector('.aic-front').value, back: el.querySelector('.aic-back').value, categoryId: el.querySelector('.aic-cat').value, area: el.querySelector('.aic-area').value, checked: el.querySelector('.aic-check input').checked, svOn: !!el.querySelector('.aic-sv')?.checked, alsoText: el.querySelector('.aic-countries').value } : {}; return { tip: p.tip, front: p.front, back: p.back, categoryId: p.categoryId, area: p.area, checked: p.checked, svOn: p.svOn, alsoText: p.alsoText, score: p.score, mapRegions: p.mapRegions, done: !!p.done, ...f }; }), meta);
    persistNow = persist;
    let pt = null;
    body.querySelector('.aic-list').addEventListener('input', () => { clearTimeout(pt); pt = setTimeout(persist, 400); });
    body.querySelector('.aic-list').addEventListener('change', () => { clearTimeout(pt); pt = setTimeout(persist, 100); });
    persist();
    startClean(list);
  };
  // 提案の時点で、地図を、あらかじめ全部消しておく（画面に出ている提案の画像を、軽量な AI で確認して、地図の範囲を黒で塗りつぶす）。
  // 見つけた範囲は覚えておき、開き直したときは、AI に聞かずに、同じ範囲を消す
  const startClean = async (list) => {
    if (!d.querySelector('#aic-automap')?.checked) return;
    const todo = list.map((p, i) => [p, i]).filter(([p]) => p.score >= getMinScore() && !p.done && !p.mapChecked && !p.cleaning && !p.blob);
    let next = 0;
    const setState = (i, t) => { const el = body.querySelector(`.aic-card[data-i="${i}"] .aic-mapstate`); if (el) el.textContent = t; };
    todo.forEach(([, i]) => setState(i, '🗺 地図を確認待ち…'));
    const worker = async () => {
      while (next < todo.length && !closed && curList === list) {
        const [p, i] = todo[next++];
        p.cleaning = true;
        setState(i, '🗺 地図を確認中…');
        try {
          const base = await deps.fetchImage(p.item);
          const regions = Array.isArray(p.mapRegions) ? p.mapRegions : await detectMapRegions(api, base);
          p.mapRegions = regions;
          p.mapChecked = true;
          if (regions.length) {
            p.blob = await eraseRegions(base, regions);
            const img = body.querySelector(`.aic-card[data-i="${i}"] .aic-img`);
            if (img) img.src = URL.createObjectURL(p.blob);
            setState(i, `✔ 地図を消しました（${regions.length} か所）`);
          } else setState(i, '地図なし');
        } catch { setState(i, '地図を確認できませんでした'); }
        p.cleaning = false;
      }
      if (curList === list) persistNow?.();
    };
    await Promise.all([worker(), worker(), worker()]);
  };
  let persistNow = null;
  const loadingHtml = '<p class="aic-state muted"><span class="spinner"></span> Plonkit のガイドを読んで、カードにするとよい項目を探しています…（20〜40 秒ほど）</p>';
  let runId = 0;
  const run = async () => {
    const mine = ++runId;
    body.innerHTML = loadingHtml;
    try {
    const answer = await askText(api, prompt(), text, getAiModel(), Math.min(30000, 2000 + getCount() * 320));
    if (mine !== runId) return;
    if (closed || mine !== runId) return;
    const list = parseProposals(answer, tips, catNames, getCount());
    if (!list.length) throw new Error('カードにできそうな項目が見つかりませんでした');
    list.forEach((p) => {
      p.categoryId = cats.find((c) => c.name === p.category)?.id || ''; p.checked = true;
      // 他の国: 2 文字のコードは、日本語の国名にして、欄に出す（読めないコードは、そのまま出して、作成のときにお知らせ）
      p.alsoText = (p.alsoRaw || []).map((x) => (/^[A-Za-z]{2}$/.test(x) ? (deps.codeName?.(x.toUpperCase()) || x.toUpperCase()) : x)).filter((x, i, a) => a.indexOf(x) === i).join('、');
    });
    renderList(list, { at: Date.now(), model: getAiModel() });
  } catch (ex) {
    if (closed || mine !== runId) return;
    body.innerHTML = `<p class="aic-err">${esc(ex.message || '提案できませんでした')}</p><div class="modal-foot"><span class="grow"></span><button class="btn" type="button" data-x>閉じる</button></div>`;
    body.querySelector('[data-x]').addEventListener('click', close);
  }
  };
  // モデルを変えたら、そのモデルで、もう一度提案する（「もう一度提案」でも）
  d.querySelector('#aic-model').addEventListener('change', (e) => { setAiModel(e.target.value); run(); });
  d.querySelector('#aic-count-sel').addEventListener('change', (e) => { try { localStorage.setItem(COUNT_KEY, e.target.value); } catch { /* 保存できなくても使える */ } run(); });
  d.querySelector('#aic-automap').addEventListener('change', (e) => { try { localStorage.setItem(AUTOMAP_KEY, e.target.checked ? '1' : '0'); } catch { /* 保存できなくても使える */ } if (curList) startClean(curList); });
  d.querySelector('#aic-minscore').addEventListener('change', (e) => { try { localStorage.setItem(MINSCORE_KEY, e.target.value); } catch { /* 保存できなくても使える */ } if (curList) renderList(curList, curMeta); });
  d.querySelector('#aic-again').addEventListener('click', () => run());
  const cached = loadCache(code, cacheCtx.sig);
  const cachedList = cached ? cached.items.map((c) => { const item = tips.get(c.tip); const sv = item ? svLinkOf(item) : ''; return { ...c, item, category: '', sv, svOn: sv ? c.svOn !== false : false, mapChecked: false }; }).filter((p) => p.item) : [];
  if (cachedList.length) renderList(cachedList, { at: cached.at, model: cached.model, cached: true }); else run();
}
