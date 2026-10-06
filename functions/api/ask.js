// AI アシスタント: ブラウザから受け取った質問と参考資料（カード・参考写真・国のデータなど）を Google の Gemini API に送り、答えをストリーミングで返す
//
// 必要な設定（Cloudflare Pages の「設定 → 変数とシークレット」）:
//   GEMINI_API_KEY     … Google AI Studio（https://aistudio.google.com/apikey）で作る API キー。「シークレット」として追加（ブラウザには出ない）。無料枠で使える
//   CHAT_MODEL         … 任意。使うモデル（初期値 gemini-3.8-flash。無料枠で使える）
//   CHAT_EFFORT        … 任意。考える深さ minimal / low / medium / high（Gemini 3 以降のモデル。初期値 low）
//   CHAT_EDITORS_ONLY  … 任意。1 にすると、編集者（Supabase の editors に登録された人）だけが使える（閲覧用アカウントは使えない。無料枠の回数を守りたいとき）
//   CHAT_ALLOW_ANON    … 任意。1 にすると、Supabase のログインなしでも使える（デモ用。公開サイトでは設定しない）
// ログイン中のユーザーだけが使えるように、Supabase のログイン情報（アクセストークン）を確認してから Gemini に送る
//
// ブラウザには、Gemini の形式ではなく、次の簡単な Server-Sent Events を返す:
//   data: {"text":"…"}                  … 答えの続き
//   data: {"done":true,"reason":"STOP"}  … 終わり（reason: STOP / MAX_TOKENS / BLOCKED / SAFETY など）
//   data: {"error":"…"}                 … 途中のエラー

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-3.8-flash';
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
function simplify(upstream) {
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
      emit(ctl, { done: true, reason: blocked ? 'BLOCKED' : finish || 'STOP' });
    },
  }));
}

export async function onRequestPost({ request, env }) {
  const origin = new URL(request.url).origin;
  const reqOrigin = request.headers.get('origin');
  if (reqOrigin && reqOrigin !== origin) return json({ error: 'forbidden' }, 403);
  if (!env.GEMINI_API_KEY) {
    // 設定の確認用: 似た名前の変数があるか・空でないか（名前と「空かどうか」だけ。値は出さない）
    const similar = Object.keys(env).filter((k) => /gemini|google|api.?key/i.test(k)).slice(0, 10).map((k) => ({ name: k, empty: !String(env[k] ?? '').trim() }));
    return json({ error: 'not_configured', similar, vars: Object.keys(env).length }, 503);
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

  const model = /^[\w.\-]+$/.test(env.CHAT_MODEL || '') ? env.CHAT_MODEL : DEFAULT_MODEL;
  const payload = { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { maxOutputTokens: 4096 } };
  // 考える深さは Gemini 3 以降のモデルだけに指定できる（古いモデルに送るとエラーになる）
  const level = ['minimal', 'low', 'medium', 'high'].includes(env.CHAT_EFFORT) ? env.CHAT_EFFORT : 'low';
  const withThinking = /^gemini-[3-9]/.test(model);
  if (withThinking) payload.generationConfig.thinkingConfig = { thinkingLevel: level.toUpperCase() };

  const call = async (p) => {
    try {
      return await fetch(`${API}/${model}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify(p),
      });
    } catch {
      return null;
    }
  };
  let res = await call(payload);
  if (!res) return json({ error: 'network', message: 'Gemini に接続できませんでした' }, 502);
  if (res.status === 400 && withThinking) { // 考える深さの指定が合わないモデルのときは、指定なしでやり直す
    const res2 = await call({ ...payload, generationConfig: { maxOutputTokens: 4096 } });
    if (res2?.ok) res = res2;
  }
  if (!res.ok) {
    let message = '';
    try { message = (await res.json())?.error?.message || ''; } catch { /* 本文なし */ }
    if (/api key|API_KEY/i.test(message) || res.status === 401 || res.status === 403) return json({ error: 'bad_key', message: 'API キーが無効か、権限がありません' }, 502);
    if (res.status === 429) return json({ error: 'rate_limited', message: '無料枠の利用回数の上限に達しました。少し待ってからもう一度お試しください（1 日の上限は、日本時間の夕方（16〜17 時ごろ）にリセットされます）' }, 429);
    return json({ error: 'upstream', status: res.status, message }, res.status >= 500 ? 503 : 502);
  }
  return new Response(simplify(res.body), { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}

// POST 以外（onRequestPost が先に処理される）
export const onRequest = () => json({ error: 'method_not_allowed' }, 405);
