// ログイン確認（functions/api/ask.js と同じ仕組み。ログインしている人だけが、サーバーの機能を使えるように）
// このファイルは、公開される API ではなく、ほかの関数から読み込まれる共通部分
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
const okTokens = new Map(); // 確認できたトークン → 期限（毎回 Supabase に問い合わせないように 1 分だけ覚える）

// 戻り値: 'ok' / 'unauthorized'
export async function authorized(request, env) {
  const { url, key } = await supabaseConfig(new URL(request.url).origin);
  if (!url) return env.CHAT_ALLOW_ANON === '1' ? 'ok' : 'unauthorized';
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return 'unauthorized';
  const exp = okTokens.get(token);
  if (exp && exp > Date.now()) return 'ok';
  const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, authorization: `Bearer ${token}` } });
  if (!res.ok) return 'unauthorized';
  if (okTokens.size > 200) okTokens.clear();
  okTokens.set(token, Date.now() + 60_000);
  return 'ok';
}
