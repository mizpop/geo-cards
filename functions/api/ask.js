// AI アシスタント: ブラウザから受け取った質問と参考資料（カード・参考写真・国のデータなど）を Google の Gemini API に送り、答えをストリーミングで返す
//
// 必要な設定（Cloudflare Pages の「設定 → 変数とシークレット」）:
//   GEMINI_API_KEY     … Google AI Studio（https://aistudio.google.com/apikey）で作る API キー。「シークレット」として追加（ブラウザには出ない）。無料枠で使える
//   AI（バインディング）… 任意。Cloudflare の Workers AI を「予備」として使う（Settings → Bindings → Add → Workers AI、変数名は AI）。Gemini が混み合っている・回数の上限・キー未設定のとき、自動でこちらに切り替わる。1 日 10,000 ニューロンまで無料
//   CHAT_MODEL         … 任意。最初に使うモデル（初期値 gemini-3.8-flash。無料枠で使える）
//   CHAT_FALLBACK_MODELS … 任意。混み合っている・回数の上限のときに、順に切り替えるモデル（カンマ区切り。初期値は下の FALLBACK_MODELS）
//   CHAT_EFFORT        … 任意。考える深さ minimal / low / medium / high（Gemini 3 以降のモデル。初期値 low）
//   CHAT_EDITORS_ONLY  … 任意。1 にすると、編集者（Supabase の editors に登録された人）だけが使える（閲覧用アカウントは使えない。無料枠の回数を守りたいとき）
//   CHAT_ALLOW_ANON    … 任意。1 にすると、Supabase のログインなしでも使える（デモ用。公開サイトでは設定しない）
// ログイン中のユーザーだけが使えるように、Supabase のログイン情報（アクセストークン）を確認してから Gemini に送る
//
// ブラウザには、Gemini の形式ではなく、次の簡単な Server-Sent Events を返す:
//   data: {"text":"…"}                  … 答えの続き
//   data: {"done":true,"reason":"STOP","model":"gemini-3.8-flash","switched":true} … 終わり（reason: STOP / MAX_TOKENS / BLOCKED / SAFETY など。model は実際に答えたモデル、switched は混み合いなどで自動で切り替えたとき）
//   data: {"error":"…"}                 … 途中のエラー

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-3.8-flash';
// 新しいモデルは混み合って 503（high demand）になりやすいので、そのときは、無料枠で使える別のモデルに順に切り替える
// 手動で選べるモデル（無料枠で使える文章のモデル。画面の選択欄 js/assistant.js の MODELS と合わせる）。これ以外の指定は受け付けない
const FREE_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview'];
// 予備（と、手動で選べる）Cloudflare Workers AI のモデル。画像も読める
const CF_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
const CF_LABEL = 'cloudflare:llama-4-scout';
const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const SWITCH_ON = new Set([429, 500, 502, 503, 504]); // これらのときだけ次のモデルを試す（キーや入力の問題は、どのモデルでも同じなので切り替えない）
const MAX_MESSAGES = 20; // 会話の履歴の最大数
const MAX_TEXT = 4000; // 1 つの発言の最大文字数
const MAX_CONTEXT = 40000; // 参考資料の最大文字数
const MAX_IMAGE_B64 = 6_000_000; // 添付画像（base64）の最大の長さ
const MAX_BODY = 8_000_000; // リクエスト全体の最大バイト数
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const SYSTEM = `あなたは GeoChecker（GeoGuessr で国や地域を当てるための手がかりを、覚えて確かめる学習アプリ）の AI アシスタントです。
ユーザーは、ボラード・電柱・シェブロン・ナンバープレート・ガードレール・道路標示・言語や文字・Google カーの世代・通行方向などの手がかりを学んでいます。

回答の方針:
- 日本語で、簡潔に答えます。まず結論、そのあとに根拠や見分け方を書きます。必要なら短い箇条書きを使います。
- 「参考資料」（ユーザーのカード、参考写真の解説、国ごとの地図のデータ、学習の記録）を最優先の根拠にします。資料にあることは資料のとおりに答えます。資料にないことは一般的な知識で補ってよいですが、「資料にはありませんが」のように区別して伝えます。
- 資料と自分の知識が食い違うときは、その旨を伝えます。確信が持てないことは、推測で断定せず、そう伝えます。
- 資料の項目を根拠にするときは、項目の ID（[C1]、[P2] のように角括弧で囲まれたもの）を、そのまま文中に書いて示します。資料にない ID は作りません。国は [国:PL] のように国コードでも示せます。
- 画像が添付されたときは、読み取れる手がかり（色・形・文字・標識・植生・建物・道路・ナンバー・ボラード・電柱など）を挙げて、考えられる国や地域を、確度とともに答えます。
- GeoGuessr の学習のための質問に答えます。人物や個人の居場所を特定する目的の調査は手伝いません。
- 見出しや表は使わず、読みやすい短い文章と箇条書きで答えます。`;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

// Supabase の接続先は、公開されている js/config.js から読む（ログインの確認だけに使う公開キー）
let supa = null;
async function supabaseConfig(origin) {
  if (supa) return supa;
  const text = await (await fetch(`${origin}/js/config.js`)).text();
  supa = {
    url: /SUPABASE_URL:\s*'([^']*)'/.exec(text)?.[1] || '',
    key: /SUPABASE_KEY:\s*'([^']*)'/.exec(text)?.[1] || '',
  };
  return supa;
}
const okTokens = new Map(); // 確認できたトークン → { 有効な期限, 編集者か }（毎回 Supabase に問い合わせないように 1 分だけ覚える）
// 戻り値: 'ok' / 'unauthorized'（ログインしていない）/ 'forbidden'（編集者ではない）
async function authorized(request, env) {
  const { url, key } = await supabaseConfig(new URL(request.url).origin);
  if (!url) return env.CHAT_ALLOW_ANON === '1' ? 'ok' : 'unauthorized'; // Supabase 未設定（デモ）は、明示したときだけ許可
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return 'unauthorized';
  let hit = okTokens.get(token);
  if (!hit || hit.exp < Date.now()) {
    const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, authorization: `Bearer ${token}` } });
    if (!res.ok) return 'unauthorized';
    const id = (await res.json().catch(() => ({})))?.id || '';
    let editor = false;
    if (env.CHAT_EDITORS_ONLY === '1' && id) {
      const r = await fetch(`${url}/rest/v1/editors?select=user_id&user_id=eq.${encodeURIComponent(id)}`, { headers: { apikey: key, authorization: `Bearer ${token}` } });
      editor = r.ok && (await r.json().catch(() => [])).length > 0;
    }
    hit = { exp: Date.now() + 60_000, editor };
    if (okTokens.size > 200) okTokens.clear();
    okTokens.set(token, hit);
  }
  return env.CHAT_EDITORS_ONLY === '1' && !hit.editor ? 'forbidden' : 'ok';
}

// Gemini の Server-Sent Events（candidates[].content.parts[].text）を、上の簡単な形に変えて流す
function simplify(upstream, model, first) {
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = '';
  let finish = '';
  let blocked = '';
  const emit = (ctl, obj) => ctl.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
  const handle = (chunk, ctl) => {
    const data = chunk.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
    if (!data) return;
    let ev;
    try { ev = JSON.parse(data); } catch { return; }
    if (ev.error) { emit(ctl, { error: ev.error.message || 'エラーが起きました' }); return; }
    if (ev.promptFeedback?.blockReason) blocked = ev.promptFeedback.blockReason;
    const cand = ev.candidates?.[0];
    for (const p of cand?.content?.parts || []) if (typeof p.text === 'string' && p.text && !p.thought) emit(ctl, { text: p.text });
    if (cand?.finishReason) finish = cand.finishReason;
  };
  return upstream.pipeThrough(new TransformStream({
    transform(chunk, ctl) {
      buf += dec.decode(chunk, { stream: true });
      for (let m = /\r?\n\r?\n/.exec(buf); m; m = /\r?\n\r?\n/.exec(buf)) {
        handle(buf.slice(0, m.index), ctl);
        buf = buf.slice(m.index + m[0].length);
      }
    },
    flush(ctl) {
      if (buf.trim()) handle(buf, ctl);
      emit(ctl, { done: true, reason: blocked ? 'BLOCKED' : finish || 'STOP', model, ...(first && model !== first ? { switched: true } : {}) });
    },
  }));
}

// Cloudflare Workers AI の Server-Sent Events（{"response":"…"} または OpenAI 形式の choices[].delta.content）を、同じ簡単な形に変えて流す
function simplifyCf(upstream, label, switched) {
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = '';
  const emit = (ctl, obj) => ctl.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
  const handle = (chunk, ctl) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let ev;
      try { ev = JSON.parse(data); } catch { continue; }
      const text = typeof ev.response === 'string' ? ev.response : ev.choices?.[0]?.delta?.content ?? ev.choices?.[0]?.text ?? '';
      if (typeof text === 'string' && text) emit(ctl, { text });
    }
  };
  return upstream.pipeThrough(new TransformStream({
    transform(chunk, ctl) {
      buf += dec.decode(chunk, { stream: true });
      for (let m = /\r?\n\r?\n/.exec(buf); m; m = /\r?\n\r?\n/.exec(buf)) {
        handle(buf.slice(0, m.index), ctl);
        buf = buf.slice(m.index + m[0].length);
      }
    },
    flush(ctl) {
      if (buf.trim()) handle(buf, ctl);
      emit(ctl, { done: true, reason: 'STOP', model: label, ...(switched ? { switched: true } : {}) });
    },
  }));
}

// Cloudflare Workers AI に質問する。画像つきで失敗したときは、画像なしでやり直す（そのときは本文の先頭に断りを入れる）
async function askCloudflare(env, system, messages, img, label, switched) {
  const chat = [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role, content: m.text }))];
  const run = (withImage) => {
    const msgs = chat.map((m) => ({ ...m }));
    if (withImage && img) msgs[msgs.length - 1].content = [{ type: 'text', text: msgs[msgs.length - 1].content }, { type: 'image_url', image_url: { url: `data:${img.media_type};base64,${img.data}` } }];
    return env.AI.run(CF_MODEL, { messages: msgs, stream: true, max_tokens: 2048 });
  };
  let out;
  let noImage = false;
  try {
    out = await run(true);
  } catch (e) {
    if (!img) throw e;
    out = await run(false); // 画像を読めなかったとき
    noImage = true;
  }
  let stream = out instanceof ReadableStream ? out : new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ response: String(out?.response ?? '') })}\n\n`)); c.close(); } });
  stream = simplifyCf(stream, label, switched);
  if (!noImage) return stream;
  const note = new TextEncoder().encode(`data: ${JSON.stringify({ text: '（この AI は画像を読み取れなかったため、画像なしで答えます）\n\n' })}\n\n`);
  return new ReadableStream({ async start(c) { c.enqueue(note); const r = stream.getReader(); for (;;) { const { value, done } = await r.read(); if (done) break; c.enqueue(value); } c.close(); } });
}
const cfError = (e, manual) => (/daily free allocation|neurons|quota|limit|429/i.test(String(e?.message || e))
  ? json({ error: 'rate_limited', manual, model: CF_LABEL, message: 'Cloudflare AI の無料枠（1 日 10,000 ニューロン）を使い切りました。日本時間の朝 9 時にリセットされます' }, 429)
  : json({ error: 'busy', manual, model: CF_LABEL, message: 'Cloudflare AI からも答えをもらえませんでした。少し待ってからもう一度お試しください' }, 503));

export async function onRequestPost({ request, env }) {
  const origin = new URL(request.url).origin;
  const reqOrigin = request.headers.get('origin');
  if (reqOrigin && reqOrigin !== origin) return json({ error: 'forbidden' }, 403);
  if (!env.GEMINI_API_KEY && !env.AI) {
    // 設定の確認用: 似た名前の変数があるか・空でないか（名前と「空かどうか」だけ。値は出さない）
    const similar = Object.keys(env).filter((k) => /gemini|google|api.?key/i.test(k)).slice(0, 10).map((k) => ({ name: k, empty: !String(env[k] ?? '').trim() }));
    return json({ error: 'not_configured', similar, vars: Object.keys(env).length, ai: !!env.AI }, 503);
  }
  const who = await authorized(request, env);
  if (who === 'unauthorized') return json({ error: 'unauthorized' }, 401);
  if (who === 'forbidden') return json({ error: 'editors_only' }, 403);
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return json({ error: 'too_large' }, 413);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const raw = Array.isArray(body?.messages) ? body.messages.slice(-MAX_MESSAGES) : [];
  const messages = raw
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, text: m.content.slice(0, MAX_TEXT) }));
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== 'user') return json({ error: 'bad_request' }, 400);

  // Gemini の形式: contents[{ role: 'user' | 'model', parts: [...] }]。添付画像は、いまの質問（最後の発言）にだけ付ける
  const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] }));
  const img = body.image;
  if (img) {
    if (!IMAGE_TYPES.has(img.media_type) || typeof img.data !== 'string' || img.data.length > MAX_IMAGE_B64 || !/^[A-Za-z0-9+/=]+$/.test(img.data)) return json({ error: 'bad_image' }, 400);
    contents[contents.length - 1].parts.unshift({ inlineData: { mimeType: img.media_type, data: img.data } });
  }

  const context = typeof body.context === 'string' ? body.context.slice(0, MAX_CONTEXT) : '';
  const system = context.trim() ? `${SYSTEM}\n\n<参考資料>\n${context}\n</参考資料>` : SYSTEM;

  // 画面で選ばれたモデル: 'auto'（自動）/ Gemini のモデル / 'cloudflare'
  const wantCf = body.model === 'cloudflare' && !!env.AI; // 予備の AI が設定されていないときは、自動と同じ
  const manual = typeof body.model === 'string' && FREE_MODELS.includes(body.model);
  const useGemini = !!env.GEMINI_API_KEY && !wantCf;
  const valid = (m) => /^[\w.\-]+$/.test(m || '');
  const chain = manual ? [body.model] : [...new Set([
    valid(env.CHAT_MODEL) ? env.CHAT_MODEL : DEFAULT_MODEL,
    ...(env.CHAT_FALLBACK_MODELS ? String(env.CHAT_FALLBACK_MODELS).split(',').map((x) => x.trim()).filter(valid) : FALLBACK_MODELS),
  ])].slice(0, 4);
  // 考える深さは Gemini 3 以降のモデルだけに指定できる（古いモデルに送るとエラーになる）
  const level = ['minimal', 'low', 'medium', 'high'].includes(env.CHAT_EFFORT) ? env.CHAT_EFFORT : 'low';
  const base = { systemInstruction: { parts: [{ text: system }] }, contents };
  const send = async (model, generationConfig) => {
    try {
      return await fetch(`${API}/${model}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({ ...base, generationConfig }),
      });
    } catch {
      return null;
    }
  };
  const attempt = async (model) => {
    const withThinking = /^gemini-[3-9]/.test(model);
    const cfg = { maxOutputTokens: 4096, ...(withThinking ? { thinkingConfig: { thinkingLevel: level.toUpperCase() } } : {}) };
    let r = await send(model, cfg);
    if (r && r.status === 400 && withThinking) { // 考える深さの指定が合わないモデルのときは、指定なしでやり直す
      const r2 = await send(model, { maxOutputTokens: 4096 });
      if (r2?.ok) r = r2;
    }
    return r;
  };
  let res = null;
  let used = '';
  if (useGemini) {
    for (const m of chain) {
      const r = await attempt(m);
      if (r) { res = r; used = m; }
      if (r?.ok || (r && !SWITCH_ON.has(r.status))) break;
    }
    if (res?.ok) return new Response(simplify(res.body, used, manual ? '' : chain[0]), { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
  }
  // Cloudflare AI: 手動で選ばれたとき、または、自動のときに Gemini が使えなかったとき（キー未設定・混み合い・上限・エラー）の予備
  if (env.AI && (wantCf || (!manual && !res?.ok))) {
    try {
      const stream = await askCloudflare(env, system, messages, img ? { media_type: img.media_type, data: img.data } : null, CF_LABEL, useGemini);
      return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
    } catch (e) {
      return cfError(e, wantCf);
    }
  }
  if (!res) return json({ error: 'network', message: 'Gemini に接続できませんでした' }, 502);
  let message = '';
  try { message = (await res.json())?.error?.message || ''; } catch { /* 本文なし */ }
  if (/api key|API_KEY/i.test(message) || res.status === 401 || res.status === 403) return json({ error: 'bad_key', message: 'API キーが無効か、権限がありません' }, 502);
  if (res.status === 429) return json({ error: 'rate_limited', manual, model: used, message: '無料枠の利用回数の上限に達しました。少し待ってからもう一度お試しください（1 日の上限は、日本時間の夕方（16〜17 時ごろ）にリセットされます）' }, 429);
  if (res.status >= 500) return json({ error: 'busy', manual, model: used, status: res.status, message: 'AI（Gemini）が混み合っています。少し待ってからもう一度お試しください' }, 503);
  return json({ error: 'upstream', status: res.status, message }, 502);
}

// 設定の確認用: どの AI が使える状態か（真偽だけ。キーなどの中身は出さない）
export const onRequestGet = ({ env }) => json({ gemini: !!env.GEMINI_API_KEY, cloudflareAI: !!env.AI, editorsOnly: env.CHAT_EDITORS_ONLY === '1' });

// POST 以外（onRequestPost が先に処理される）
export const onRequest = () => json({ error: 'method_not_allowed' }, 405);
