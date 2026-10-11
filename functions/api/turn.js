// ボイスチャット用の TURN（Cloudflare Calls）の接続情報を、ログインしている人に渡す
// 使うには、Cloudflare Pages の「設定 → 変数とシークレット」に、CF_TURN_KEY_ID と CF_TURN_API_TOKEN（Cloudflare の「Calls → TURN」で作る）を設定する
// 設定がなければ、空の一覧を返す（アプリは、STUN だけで、つなぐ）
import { authorized } from './ask.js';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export async function onRequestGet({ request, env }) {
  if ((await authorized(request, env)) === 'unauthorized') return json({ error: 'unauthorized' }, 401);
  if (!env.CF_TURN_KEY_ID || !env.CF_TURN_API_TOKEN) return json({ iceServers: [], configured: false });
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.CF_TURN_KEY_ID)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.CF_TURN_API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: 6 * 3600 }),
    });
    if (!res.ok) return json({ iceServers: [], configured: true, error: 'turn_failed' });
    const j = await res.json();
    const servers = (Array.isArray(j.iceServers) ? j.iceServers : [j.iceServers]).filter(Boolean);
    return json({ iceServers: servers, configured: true });
  } catch {
    return json({ iceServers: [], configured: true, error: 'turn_failed' });
  }
}
