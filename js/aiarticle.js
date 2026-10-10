// AI に記事を書いてもらう（ガイドの編集画面の「✨ AI」）
// AI には、アプリのデータ（カード・保存したストリートビュー・他の記事の題名・国の情報・参考写真の解説・Plonk It のガイド）と、
// 今の下書き、記事の書式（マークダウン）を、参考資料として渡す。ユーザーは、追加の指示も書ける。
// AI の答えは、そのまま記事に入れない。確認の画面で、編集して、「置き換える・末尾に足す・カーソルの位置に入れる・新しい下書きとして保存」を選ぶ。
import { AI_MODELS, getAiModel, setAiModel } from './assistant.js';

const MODES = [
  ['continue', '下書きの続きを書く', '今の下書きの続きの部分を書く（続きだけを出す）'],
  ['polish', '下書きを整える・書き足す', '今の下書き全体を、読みやすく整える。足りないところは、資料から書き足す'],
  ['new', 'テーマから、新しく書く', '下書きは、参考にしない（空なら、これを選ぶ）。指示のテーマで、記事を 1 本書く'],
];
const MODE_TEXT = {
  continue: '今の下書きの続きの部分を書いてください。本文には、続きの部分だけを出してください（今の下書きは、繰り返さない）。',
  polish: '今の下書き全体を、読みやすく整えて、足りないところは、資料から書き足してください。本文には、整えた記事の全文を出してください。',
  new: '指示のテーマで、新しい記事を 1 本書いてください。今の下書きは、書き方の参考にしてよいですが、内容は引き継がなくて構いません。',
};

// AI に渡す、記事の書式の説明
export const MARKDOWN_SPEC = `記事の書式（マークダウンの一部。これだけが使える）:
- 見出し: # 大見出し / ## 見出し / ### 小見出し（目次に出る）
- 太字 **文字** / 斜体 *文字* / 取り消し線 ~~文字~~ / コード \`文字\`
- 箇条書き: 行の先頭に「- 」（入れ子は、字下げ）/ 番号つき: 「1. 」/ 引用: 「> 」/ 区切り線: 「---」
- 表: | 見出し | 見出し | の行、次の行に | --- | --- |、そのあとに行
- コードブロック: \`\`\` で囲む
- 外のリンク: [文字](https://…)
- 画像: ![説明](card:カードのID)（そのカードの画像を表示）。説明の最後に |50% や |300px を付けると、表示の大きさになる（例: ![説明|50%](card:ID)）。アップロードした画像は ![説明](img:パス) で、下書きにあるものは、そのまま残す
- カードへのリンク: [[card:ID]] / 保存したストリートビューへのリンク: [[sv:ID]] / 別の記事へのリンク: [[article:ID]]
  - これらだけで 1 行を使うと、大きな枠で表示される。文章の途中に入れると、行に収まる小さな表示になる
  - ID は、参考資料にあるものだけを使う（作らない）`;

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

/** AI の出力 → { title, body }（===TITLE=== と ===BODY=== で区切られている。区切りがなければ、全部が本文） */
export function parseOutput(text) {
  let t = String(text || '').replace(/\r\n?/g, '\n');
  t = t.replace(/^\s*```(?:markdown|md)?\n([\s\S]*?)\n```\s*$/i, '$1'); // 全体をコードブロックで囲んでしまったとき
  const b = t.indexOf('===BODY===');
  if (b < 0) return { title: '', body: t.replace(/===TITLE===\s*/, '').trim() };
  const head = t.slice(0, b).replace(/===TITLE===/, '').trim();
  return { title: head.split('\n')[0].trim().replace(/^#+\s*/, ''), body: t.slice(b + '===BODY==='.length).replace(/^\s*\n/, '').trimEnd() };
}

/** 存在しないカード・ストリートビュー・記事への、リンクと画像を取り除く。戻り値: { md, removed } */
export function dropBadRefs(md, ok) {
  let removed = 0;
  const bad = () => { removed++; return ''; };
  let s = md.replace(/!\[[^\]]*\]\(card:([\w-]+)\)/g, (m, id) => (ok.card(id) ? m : bad()));
  s = s.replace(/\[\[(card|sv|article):([\w-]+)\]\]/g, (m, k, id) => (ok[k](id) ? m : bad()));
  return { md: s.replace(/\n{3,}/g, '\n\n'), removed };
}

async function askStream({ api, messages, context, model, signal, onText }) {
  const token = await api.getAccessToken();
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ messages, context, model, task: 'article', maxTokens: 12000 }),
    signal,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error === 'not_configured' ? 'AI が設定されていません（GEMINI_API_KEY か OPENROUTER_API_KEY）'
      : j.error === 'editors_only' ? 'AI は、編集者のアカウントだけが使えます'
        : j.message || j.error || (res.status === 404 ? 'この環境では、AI を使えません（サーバー側の機能がありません）' : `AI に接続できませんでした（${res.status}）`));
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = ''; let text = ''; let note = '';
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
      if (typeof j.text === 'string') { text += j.text; onText?.(text); }
      if (j.error) throw new Error(j.error);
      if (j.done) {
        if (/^(BLOCKED|SAFETY|PROHIBITED_CONTENT|RECITATION)/.test(j.reason || '')) note = 'AI が、この内容には答えられないと判断して、止まりました';
        else if (j.reason === 'MAX_TOKENS') note = '長くなったため、途中で終わっています';
      }
    }
  }
  return { text, note };
}

/**
 * 参考資料を組み立てる（アプリのデータ全体から、記事に関係するものを選んで、文章にする）
 * @param {object} o { form, instruction, mode, use: {cards, sv, facts, plonkit, articles}, plonkitCodes, proposal }
 */
async function buildContext(d, o) {
  const { form, instruction, use } = o;
  const ai = d.ai;
  const out = [];
  out.push(['記事の書式', MARKDOWN_SPEC]);
  const hasDraft = (form.title || form.body).trim();
  out.push(['今の下書き', hasDraft ? `タイトル: ${form.title || '（未入力）'}\n本文:\n${clip0(form.body, 40000)}` : '（まだ何も書かれていません）']);
  if (o.proposal) out.push(['直前の AI の提案（ユーザーが、手直ししたもの）', `タイトル: ${o.proposal.title || '（なし）'}\n本文:\n${clip0(o.proposal.body, 40000)}\n\n※ユーザーの今回の指示は、この提案を、直すための指示です。直した結果を、出力してください。`]);
  const text = `${instruction}\n${form.title}\n${form.body}`;
  const countries = ai.detectCountries(text);
  const kw = [...new Set((text.match(/[゠-ヿ]{2,}|[一-鿿]{2,}|[A-Za-z0-9]{3,}/g) || []))].slice(0, 60);

  if (use.cards) {
    const cards = ai.cards();
    const scored = cards.map((c) => {
      const label = ai.cardLabel(c);
      const body = `${label} ${c.description || ''} ${c.notes || ''} ${c.area || ''} ${(c.places || []).map((p) => `${p.name || ''}${p.en || ''}`).join(' ')}`.toLowerCase();
      let s = 0;
      if ((c.countries || []).some((x) => countries.includes(x))) s += 5;
      for (const w of kw) if (body.includes(w.toLowerCase())) s += 1;
      return { c, s, label };
    }).sort((a, b) => b.s - a.s);
    const detail = scored.filter((x) => x.s > 0).slice(0, 30);
    const line = (x) => `[card:${x.c.id}] ${x.label}${x.c.area ? `（${clip(x.c.area, 40)}）` : ''}${x.c.places?.length ? `／地名: ${x.c.places.map((p) => [p.name, p.en].filter(Boolean).join('・')).join('、')}` : ''}${x.c.description ? `／${clip(x.c.description, 220)}` : ''}${x.c.notes ? `／メモ: ${clip(x.c.notes, 220)}` : ''}`;
    out.push(['カード（関係が深いもの。画像は ![説明](card:ID)、リンクは [[card:ID]]）', detail.length ? detail.map(line).join('\n') : '（関係が深いカードは、見つかりませんでした）']);
    const rest = scored.filter((x) => !detail.includes(x)).slice(0, 400);
    if (rest.length) out.push([`カードの一覧（そのほか ${rest.length} 枚。ID｜種類・国｜説明）`, rest.map((x) => `[card:${x.c.id}] ${x.label}${x.c.description ? `／${clip(x.c.description, 40)}` : ''}`).join('\n')]);
  }
  if (use.sv) {
    const rows = ai.svList().slice(0, 200);
    out.push(['保存したストリートビュー（リンクは [[sv:ID]]）', rows.length ? rows.map((r) => `[sv:${r.id}] ${ai.svLabel(r)}`).join('\n') : '（保存したストリートビューは、ありません）']);
  }
  if (use.articles) {
    const rows = d.articles().filter((a) => a.id !== d.currentId).slice(0, 200);
    out.push(['ほかの記事（リンクは [[article:ID]]）', rows.length ? rows.map((a) => `[article:${a.id}] ${a.title || '無題'}${a.body ? `／${clip(a.body.replace(/[#>*`|\[\]!()-]/g, ' '), 50)}` : ''}`).join('\n') : '（ほかの記事は、ありません）']);
  }
  if (use.facts) {
    const t = await ai.factsText(text).catch(() => '');
    if (t) out.push(['国の情報・参考写真の解説・学習の記録（[C1] [P1] のような ID は、記事には、書かない）', t]);
  }
  if (use.plonkit) {
    const codes = (o.plonkitCodes.length ? o.plonkitCodes : countries).slice(0, 2);
    for (const code of codes) {
      const t = await ai.plonkitText(code).catch(() => '');
      if (t) out.push([`Plonk It のガイド（${ai.countryName(code)}。日本語訳）`, clip0(t, 45000)]);
    }
  }
  return { text: out.map(([t, b]) => `## ${t}\n${b}`).join('\n\n'), countries };
}
const clip0 = (s, n) => { const t = String(s || ''); return t.length > n ? `${t.slice(0, n)}\n…（長いので、ここまで）` : t; };

/**
 * AI の画面を開く
 * @param {object} d {
 *   api, esc, toast, confirm, articles(), currentId,
 *   ai: { cards(), cardLabel(c), countryName(code), svList(), svLabel(r), detectCountries(text), resolveCountry(name), plonkitText(code), factsText(text) },
 *   getForm() → { title, body, folder_id }, preview(md) → html, exists: { card(id), sv(id), article(id) },
 *   apply({ mode: 'replace'|'append'|'insert', title, body }), saveAsDraft({ title, body, folder_id }) }
 */
export function openArticleAi(d) {
  const esc = d.esc;
  const dlg = document.createElement('dialog');
  dlg.className = 'modal modal-wide gd-ai';
  const form0 = d.getForm();
  const empty = !(form0.title || form0.body).trim();
  const lastMode = (() => { try { return localStorage.getItem('geo-guide-ai-mode'); } catch { return null; } })();
  const mode0 = empty ? 'new' : (MODES.some((m) => m[0] === lastMode && m[0] !== 'new') ? lastMode : 'continue');
  const useSaved = (() => { try { return JSON.parse(localStorage.getItem('geo-guide-ai-use')) || {}; } catch { return {}; } })();
  const chk = (k, label, def = true) => `<label class="gd-ai-chk"><input type="checkbox" data-use="${k}" ${(k in useSaved ? useSaved[k] : def) ? 'checked' : ''}> ${label}</label>`;
  dlg.innerHTML = `<div class="modal-inner">
    <div class="modal-head"><h2>✨ AI で記事を書く</h2><button class="icon-btn" type="button" data-x aria-label="閉じる">✕</button></div>
    <div class="gd-ai-step" id="ai-s1">
      <div class="field"><span>何をしてもらうか</span>
        <select class="select" id="ai-mode">${MODES.map(([k, l, t]) => `<option value="${k}" title="${esc(t)}" ${k === mode0 ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><span>追加の指示（テーマ・書きたい内容・文体・長さ・入れてほしいカードなど）</span>
        <textarea id="ai-inst" class="input" rows="4" maxlength="3500" placeholder="例: ポーランドのボラードの見分け方を、初心者向けに。似ているチェコとの違いも。カードの画像を入れて。"></textarea></div>
      <div class="field"><span>AI に読ませるデータ</span>
        <div class="gd-ai-uses">${chk('cards', 'カード')}${chk('sv', 'ストリートビュー')}${chk('facts', '国の情報・参考写真')}${chk('plonkit', 'Plonk It のガイド')}${chk('articles', 'ほかの記事')}<span class="muted small">（今の下書きと、記事の書式は、いつも読みます）</span></div></div>
      <div class="gd-ai-row"><label class="muted small" for="ai-plon">Plonk It を読む国</label><input type="text" id="ai-plon" class="input input-sm" placeholder="空欄なら、指示や下書きに出てくる国（最大 2 か国）。例: ポーランド、チェコ">
        <label class="muted small" for="ai-model">モデル</label><select class="select select-sm" id="ai-model">${AI_MODELS.map(([id, label]) => `<option value="${esc(id)}" ${id === getAiModel() ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></div>
      <p class="muted small">AI の答えは、そのまま記事には入りません。次の画面で、内容を確認・編集してから、反映するかを選びます。</p>
      <div class="modal-foot"><span class="grow"></span><button class="btn btn-ghost" type="button" data-x>閉じる</button><button class="btn btn-primary" type="button" id="ai-go">✨ 書いてもらう</button></div>
    </div>
    <div class="gd-ai-step" id="ai-s2" hidden>
      <p class="muted small" id="ai-state"></p>
      <div class="gd-ai-review">
        <div class="gd-ai-edit">
          <label class="muted small" for="ai-title">タイトル（AI の提案）</label><input type="text" id="ai-title" class="input" maxlength="200">
          <label class="muted small" for="ai-body">本文（AI の提案。ここで、直せます）</label><textarea id="ai-body" class="input gd-ai-body" spellcheck="false"></textarea>
        </div>
        <div class="gd-ai-prev"><span class="muted small">プレビュー</span><div class="gd-preview pk-body" id="ai-prev"></div></div>
      </div>
      <p class="small gd-ai-warn" id="ai-warn" hidden></p>
      <div class="field"><span>直してほしいところがあれば（今の提案を、AI が、指示のとおりに直します）</span>
        <div class="gd-ai-row"><input type="text" id="ai-more" class="input" maxlength="1000" placeholder="例: もう少し短く / 表にまとめて / チェコとの違いを足して"><button class="btn" type="button" id="ai-redo">↻ 指示を足して、書き直す</button></div></div>
      <div class="gd-ai-apply">
        <label class="gd-ai-chk"><input type="checkbox" id="ai-withtitle"> タイトルも反映する</label>
        <span class="grow"></span>
        <button class="btn" type="button" id="ai-draft" title="今の記事には入れずに、この提案を、新しい下書きとして保存する（あとで、下書きの一覧から開ける）">📄 新しい下書きとして保存</button>
        <button class="btn" type="button" data-ap="insert" title="記事のカーソルの位置に入れる">カーソルの位置に入れる</button>
        <button class="btn" type="button" data-ap="append" title="今の本文の最後に足す">末尾に足す</button>
        <button class="btn btn-primary" type="button" data-ap="replace" title="今の本文を、この提案で置き換える（確認が出ます）">本文を置き換える</button>
      </div>
      <div class="modal-foot"><button class="btn btn-ghost" type="button" id="ai-back">← 指示に戻る</button><span class="grow"></span><button class="btn btn-ghost" type="button" data-x>閉じる</button></div>
    </div>
  </div>`;
  document.body.appendChild(dlg);
  const $ = (s) => dlg.querySelector(s);
  let controller = null;
  let busy = false;
  let proposal = null; // { title, body }
  let removedRefs = 0;
  const close = () => {
    controller?.abort();
    document.activeElement?.blur?.();
    dlg.close(); dlg.remove();
    setTimeout(() => { window.blur(); window.focus(); }, 0); // 閉じたあとに、入力欄へ入力できなくなることがあるので、フォーカスを取り直す
  };
  dlg.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', close));
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (busy && !window.confirm?.('AI が書いている途中です。やめますか？')) return; close(); });
  dlg.showModal();
  $('#ai-inst').focus();

  const sanitize = (p) => { const r = dropBadRefs(p.body, d.exists); removedRefs = r.removed; return { title: p.title, body: r.md }; };
  const paintPreview = (() => {
    let tm = null;
    return () => { clearTimeout(tm); tm = setTimeout(async () => { try { $('#ai-prev').innerHTML = (await d.preview($('#ai-body').value)) || '<p class="muted small">プレビューが、ここに出ます</p>'; } catch { /* 無視 */ } }, 250); };
  })();
  $('#ai-body').addEventListener('input', paintPreview);
  const showWarn = () => {
    const w = $('#ai-warn');
    w.hidden = !removedRefs;
    if (removedRefs) w.textContent = `⚠ 存在しないカード・ストリートビュー・記事への参照が ${removedRefs} 件あったので、取り除きました。`;
  };

  const run = async (extra = '') => {
    if (busy) return;
    const mode = $('#ai-mode').value;
    const inst = $('#ai-inst').value.trim();
    const use = {}; dlg.querySelectorAll('[data-use]').forEach((c) => { use[c.dataset.use] = c.checked; });
    try { localStorage.setItem('geo-guide-ai-use', JSON.stringify(use)); localStorage.setItem('geo-guide-ai-mode', mode); } catch { /* 無視 */ }
    const form = d.getForm();
    if (mode === 'new' && !inst) { d.toast('新しく書くときは、テーマを、追加の指示に書いてください', 'error'); $('#ai-inst').focus(); return; }
    if ((mode === 'continue' || mode === 'polish') && !(form.title || form.body).trim()) { d.toast('下書きが空です。「テーマから、新しく書く」を選んでください', 'error'); return; }
    setAiModel($('#ai-model').value);
    const plonkitCodes = [];
    for (const n of $('#ai-plon').value.split(/[、,，\n]/).map((x) => x.trim()).filter(Boolean)) { const c = d.ai.resolveCountry(n); if (c && !plonkitCodes.includes(c)) plonkitCodes.push(c); }
    busy = true;
    controller = new AbortController();
    $('#ai-s1').hidden = true; $('#ai-s2').hidden = false;
    $('#ai-state').textContent = '資料を集めています…';
    $('#ai-redo').disabled = true; dlg.querySelectorAll('[data-ap],#ai-draft').forEach((b) => { b.disabled = true; });
    try {
      const ctx = await buildContext(d, { form, instruction: inst, mode, use, plonkitCodes, proposal: extra ? { title: $('#ai-title').value, body: $('#ai-body').value } : null });
      const names = ctx.countries.slice(0, 3).map((c) => d.ai.countryName(c)).join('・');
      const message = `${MODE_TEXT[mode]}\n${inst ? `\n【ユーザーの追加の指示】\n${inst}\n` : ''}${extra ? `\n【直してほしいところ（今回の指示。これを最優先）】\n${extra}\n` : ''}`.slice(0, 3900);
      $('#ai-state').textContent = `AI が書いています…${names ? `（読んだ国: ${names}）` : ''}`;
      const r = await askStream({
        api: d.api, messages: [{ role: 'user', content: message }], context: ctx.text, model: $('#ai-model').value, signal: controller.signal,
        onText: (t) => { const p = parseOutput(t); $('#ai-title').value = p.title; $('#ai-body').value = p.body; $('#ai-body').scrollTop = $('#ai-body').scrollHeight; },
      });
      const p = sanitize(parseOutput(r.text));
      if (!p.body.trim()) throw new Error('答えを受け取れませんでした。もう一度お試しください');
      proposal = p;
      $('#ai-title').value = p.title; $('#ai-body').value = p.body;
      $('#ai-withtitle').checked = !!p.title && (mode === 'new' || !form.title.trim());
      $('#ai-state').textContent = `できました${r.note ? `（${r.note}）` : ''}。内容を確認して、直してから、反映してください。`;
      showWarn(); paintPreview();
      $('#ai-redo').disabled = false; dlg.querySelectorAll('[data-ap],#ai-draft').forEach((b) => { b.disabled = false; });
      $('#ai-more').value = '';
      const def = mode === 'continue' ? 'append' : 'replace';
      dlg.querySelectorAll('[data-ap]').forEach((b) => b.classList.toggle('btn-primary', b.dataset.ap === def));
    } catch (ex) {
      if (ex.name === 'AbortError') return;
      $('#ai-state').textContent = `書けませんでした: ${ex.message}`;
      if (!$('#ai-body').value.trim()) { $('#ai-s1').hidden = false; $('#ai-s2').hidden = true; d.toast(`AI: ${ex.message}`, 'error'); } else { $('#ai-redo').disabled = false; }
    } finally { busy = false; controller = null; }
  };
  $('#ai-go').addEventListener('click', () => run());
  $('#ai-redo').addEventListener('click', () => { const more = $('#ai-more').value.trim(); if (!more) { d.toast('直してほしいところを、書いてください', 'error'); $('#ai-more').focus(); return; } run(more); });
  $('#ai-more').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('#ai-redo').click(); } });
  $('#ai-back').addEventListener('click', () => { if (busy) { controller?.abort(); busy = false; } $('#ai-s2').hidden = true; $('#ai-s1').hidden = false; });

  const current = () => ({ title: $('#ai-title').value.trim(), body: dropBadRefs($('#ai-body').value, d.exists).md.trim() });
  dlg.querySelectorAll('[data-ap]').forEach((b) => b.addEventListener('click', async () => {
    const p = current();
    if (!p.body) { d.toast('本文が空です', 'error'); return; }
    const kind = b.dataset.ap;
    const withTitle = $('#ai-withtitle').checked && p.title;
    const f = d.getForm();
    if (kind === 'replace') {
      const ok = await d.confirm(`今の本文（${f.body.length} 文字）を、この提案（${p.body.length} 文字）で置き換えます${withTitle ? `。タイトルも「${p.title}」にします` : ''}。\nよろしいですか？（適用したあとは、編集画面の「↩ AI の適用を取り消す」で、元に戻せます）`);
      if (!ok) return;
    }
    d.apply({ mode: kind, title: withTitle ? p.title : null, body: p.body });
    d.toast(kind === 'replace' ? '本文を置き換えました' : kind === 'append' ? '本文の最後に足しました' : 'カーソルの位置に入れました');
    close();
  }));
  $('#ai-draft').addEventListener('click', () => {
    const p = current();
    if (!p.body) { d.toast('本文が空です', 'error'); return; }
    const f = d.getForm();
    if (d.saveAsDraft({ title: p.title || f.title || 'AI の下書き', body: p.body, folder_id: f.folder_id || null })) { d.toast('新しい下書きとして、保存しました（下書きの一覧から開けます）'); close(); } else d.toast('下書きを保存できませんでした（ブラウザの保存容量）', 'error');
  });
}
