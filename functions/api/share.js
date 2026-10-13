// 記事の共有ページを、無料の静的サイト置き場（1FreeHosting）に公開する
// ブラウザからは、他のサイトへ直接送れない（CORS）ので、ここが受け渡しをする。ログインしている人だけが使える
// 送るのは、ブラウザが作った HTML（index.html）1 枚だけ。更新するときは、前回の deployToken を一緒に送る
import { authorized } from './ask.js';

const UPLOAD = 'https://harvis.dev/api/upload';
const MAX_BYTES = 12 * 1024 * 1024; // 1 回に送る量の上限（置き場の上限は 50 MB・500 ファイル）
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export async function onRequestPost({ request, env }) {
  if ((await authorized(request, env)) === 'unauthorized') return json({ error: 'unauthorized', message: 'ログインの確認ができませんでした' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request', message: '送られた内容を読めませんでした' }, 400); }
  const files = Array.isArray(body?.files) ? body.files : [];
  if (!files.length || files.length > 50) return json({ error: 'bad_request', message: 'ファイルの数が正しくありません' }, 400);
  let total = 0;
  const clean = [];
  for (const f of files) {
    const path = String(f?.path || '');
    // 置けるのは、静的なファイルだけ（パスは、相対・「..」なし・先頭にドットなし）
    if (!/^[\w][\w./-]{0,120}$/.test(path) || path.includes('..') || /(^|\/)\./.test(path)) return json({ error: 'bad_path', message: `ファイルの名前が使えません: ${path.slice(0, 40)}` }, 400);
    const encoding = f.encoding === 'base64' ? 'base64' : 'text';
    const content = String(f.content ?? '');
    total += content.length;
    clean.push({ path, content, encoding });
  }
  if (total > MAX_BYTES) return json({ error: 'too_large', message: 'ページが大きすぎます（画像を減らしてください）' }, 413);
  if (!clean.some((f) => f.path === 'index.html')) return json({ error: 'bad_request', message: 'index.html がありません' }, 400);
  const payload = { files: clean };
  if (typeof body.deployToken === 'string' && /^[\w-]{8,200}$/.test(body.deployToken)) payload.deployToken = body.deployToken; // 前回の公開を、更新する
  let res;
  try { res = await fetch(UPLOAD, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); } catch (e) { return json({ error: 'upstream', message: '公開先（1FreeHosting）に接続できませんでした' }, 502); }
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text); } catch { /* JSON ではない */ }
  if (!res.ok || !j?.url) return json({ error: 'upstream', status: res.status, message: `公開できませんでした（${res.status}）${j?.error || j?.message ? `: ${String(j.error || j.message).slice(0, 120)}` : ''}` }, 502);
  return json({ url: j.url, claimUrl: j.claimUrl || '', deployToken: j.deployToken || '', fileCount: j.fileCount || clean.length });
}
