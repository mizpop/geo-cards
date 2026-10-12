// 不具合の記録: 画面で起きたエラー（と、その直前の操作・通信の失敗）を、このブラウザに残す
// 設定画面から、内容をコピーして、報告できる。Supabase に error_reports の表があれば、そこにも送る（編集者が、みんなの記録を見られる）
const KEY = 'geo-errlog-v1';
const MAX = 40;
const crumbs = []; // 直前の操作（新しい順に最大 25 件）
const sent = new Set(); // 今回の起動で、もう送った（同じ）エラー
let sendCount = 0;
let deps = { version: '', userId: () => '', report: null };

const clip = (s, n) => String(s ?? '').slice(0, n);
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const save = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch { /* 保存できなくても続ける */ } };
const crumb = (text) => { crumbs.push({ t: new Date().toISOString().slice(11, 19), x: clip(text, 80) }); if (crumbs.length > 25) crumbs.shift(); };
const describe = (el) => {
  if (!el?.tagName) return '';
  const label = clip((el.getAttribute?.('aria-label') || el.title || el.textContent || '').replace(/\s+/g, ' ').trim(), 24);
  return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0]}` : ''}${label ? ` "${label}"` : ''}`;
};
const NOISE = /ResizeObserver loop|Script error\.?$|Non-Error promise rejection|The play\(\) request was interrupted|AbortError|Load failed$/i;

function record(kind, msg, stack = '', src = '') {
  msg = clip(msg, 300);
  if (!msg || NOISE.test(msg)) return;
  const sig = `${kind}|${msg}|${clip(stack, 80)}`;
  const entry = { at: new Date().toISOString(), kind, msg, stack: clip(stack, 1500), src: clip(src, 160), view: location.hash || '', ver: deps.version, ua: clip(navigator.userAgent, 140), online: navigator.onLine, w: `${innerWidth}x${innerHeight}`, crumbs: crumbs.slice(-12) };
  const list = load();
  const last = list[list.length - 1];
  if (last && last.msg === msg && last.kind === kind) { last.n = (last.n || 1) + 1; last.at = entry.at; save(list); } else { entry.n = 1; list.push(entry); save(list); }
  if (!sent.has(sig) && sendCount < 10 && deps.report) { // 同じものは、1 回だけ。多くても、10 件まで
    sent.add(sig); sendCount++;
    Promise.resolve(deps.report({ message: msg, stack: entry.stack, view: entry.view, version: entry.ver, ua: entry.ua, kind, crumbs: entry.crumbs })).catch(() => {});
  }
}

export function installErrLog(d = {}) {
  deps = { ...deps, ...d };
  if (installErrLog.done) return;
  installErrLog.done = true;
  window.addEventListener('error', (e) => {
    if (e.target && e.target !== window && e.target.tagName) return; // 画像などの読み込み失敗は、記録しない
    record('error', e.message, e.error?.stack || '', e.filename ? `${e.filename.split('/').pop()}:${e.lineno}` : '');
  });
  window.addEventListener('unhandledrejection', (e) => { const r = e.reason; record('promise', r?.message || String(r), r?.stack || ''); });
  document.addEventListener('click', (e) => { const b = e.target.closest?.('button, a, [role="button"], input, select, label, .tab') || e.target; crumb(`click ${describe(b)}`); }, true);
  window.addEventListener('hashchange', () => crumb(`画面 ${location.hash}`));
  const f = window.fetch;
  window.fetch = async function (...args) { // アプリの通信（/api/…）が失敗したら、記録に残す
    const url = String(args[0]?.url || args[0] || '');
    try {
      const res = await f.apply(this, args);
      if (url.includes('/api/') && !res.ok) { crumb(`通信 ${res.status} ${url.replace(location.origin, '').slice(0, 50)}`); if (res.status >= 500) record('fetch', `通信エラー ${res.status}`, '', url.replace(location.origin, '')); }
      return res;
    } catch (ex) {
      if (url.includes('/api/') && ex?.name !== 'AbortError') { crumb(`通信失敗 ${url.replace(location.origin, '').slice(0, 50)}`); record('fetch', `通信できません: ${ex?.message || ''}`, '', url.replace(location.origin, '')); }
      throw ex;
    }
  };
}

export const errList = () => load().slice().reverse();
export const errClear = () => { try { localStorage.removeItem(KEY); } catch { /* 無視 */ } };
/** 報告用の文章（コピーして送る） */
export function errText() {
  const list = errList();
  if (!list.length) return '（記録はありません）';
  return [`GeoChecker ${deps.version} / ${navigator.userAgent}`, ...list.map((e, i) => [`--- ${i + 1}. ${e.at}${e.n > 1 ? ` ×${e.n}` : ''} [${e.kind}] ${e.view} (${e.w})${e.online ? '' : ' オフライン'}`, e.msg, e.src, e.stack, `直前の操作: ${(e.crumbs || []).map((c) => `${c.t} ${c.x}`).join(' → ')}`].filter(Boolean).join('\n'))].join('\n\n');
}
