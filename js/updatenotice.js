// 更新の通知: アプリ（サイト）や Windows 版アプリが更新されて、初めて起動した（再起動を含む）とき、右上にポップアップで知らせる。
// 前に起動したときの版を、この端末のブラウザに覚えておいて、違っていれば出す（初めて使うときは出さない）
import { CHANGELOG, APP_VERSION } from './changelog.js';

const WEB_KEY = 'geochecker-last-version';
const DESKTOP_KEY = 'geochecker-last-desktop-version';
const num = (v) => Number(String(v).replace(/^v/i, '')) || 0;
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 無視 */ } };
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** deps: { openChangelog } */
export async function showUpdateNoticeIfNeeded(deps) {
  const lines = [];
  // ---- サイト（アプリ本体）の版
  const prevWeb = read(WEB_KEY);
  write(WEB_KEY, APP_VERSION);
  let items = [];
  if (prevWeb && num(prevWeb) < num(APP_VERSION)) {
    items = CHANGELOG.filter((v) => num(v.version) > num(prevWeb));
    lines.push({ kind: 'web', text: `${prevWeb} → ${APP_VERSION}` });
  }
  // ---- Windows 版アプリ本体の版（Electron から取れるときだけ）
  let desktop = null;
  try { desktop = await window.desktop?.getAppVersion?.(); } catch { /* 無視 */ }
  if (desktop) {
    const prev = read(DESKTOP_KEY);
    write(DESKTOP_KEY, desktop);
    if (prev && prev !== desktop) lines.push({ kind: 'desktop', text: `Windows 版アプリ ${prev} → ${desktop}` });
  }
  if (!lines.length) return;

  document.getElementById('update-notice')?.remove();
  const box = document.createElement('aside');
  box.id = 'update-notice';
  box.setAttribute('role', 'status');
  const highlights = items.slice(0, 3).map((v) => `<li><b>${esc(v.version)}</b> ${esc(v.sections.map((s) => s.title).slice(0, 3).join('・'))}</li>`).join('');
  const more = items.length > 3 ? `<li class="muted">ほか ${items.length - 3} 回分の更新</li>` : '';
  box.innerHTML = `
    <div class="un-head"><span class="un-icon">🎉</span><b>GeoChecker が更新されました</b><button type="button" class="un-x" aria-label="閉じる">✕</button></div>
    <p class="un-ver">${lines.map((l) => esc(l.text)).join('<br>')}</p>
    ${highlights || more ? `<ul class="un-list">${highlights}${more}</ul>` : ''}
    <div class="un-foot"><button type="button" class="btn btn-sm btn-primary un-log">更新履歴を見る</button></div>`;
  document.body.appendChild(box);
  const close = () => { box.classList.add('is-out'); setTimeout(() => box.remove(), 250); };
  box.querySelector('.un-x').addEventListener('click', close);
  box.querySelector('.un-log').addEventListener('click', () => { close(); deps.openChangelog?.(); });
  let timer = setTimeout(close, 25000); // 放っておいても、しばらくしたら閉じる（ポインターを乗せている間は閉じない）
  box.addEventListener('mouseenter', () => clearTimeout(timer));
  box.addEventListener('mouseleave', () => { timer = setTimeout(close, 8000); });
}
