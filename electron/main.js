// GeoChecker のデスクトップ版: 公開中のサイトを読み込むだけの入れ物。サイトを更新すれば、このアプリにも自動で反映される
// 上の細いバー（タイトルバー）に再読み込みボタンを置くため、バーとサイトを別々の画面（WebContentsView）にしている
const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const { DiscordPresence } = require('./discord');

const SITE = process.env.GEOCHECKER_SITE || 'https://geo-cards-533.pages.dev/'; // GEOCHECKER_SITE: 開発・動作確認用に、読み込む先を変える
const ownHost = new URL(SITE).host;
const BAR_H = 36;
const DISCORD_CLIENT_ID = '1557091296546652160'; // Discord のアプリケーション ID（Rich Presence 用。公開してよい ID）
const presence = new DiscordPresence(DISCORD_CLIENT_ID);
const appStart = Date.now();

const barHtml = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#141b21;color:#e6edf3;font:13px 'Segoe UI','Yu Gothic UI',sans-serif;user-select:none}
  body{display:flex;align-items:center;-webkit-app-region:drag;padding-left:12px;box-sizing:border-box}
  #t{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;opacity:.85}
  /* 右端の最小化・最大化・閉じるのボタン（約 140px）の左に置く */
  #r{-webkit-app-region:no-drag;margin-right:146px;width:30px;height:26px;display:grid;place-items:center;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer}
  #r:hover{background:#2a3640}#r:active{background:#34f0a022}
</style><div id="t">GeoChecker</div>
<button id="r" title="再読み込み（Ctrl+R）／ Shift を押しながらで、キャッシュも捨てて読み込み直す" aria-label="再読み込み"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg></button>
<script>
  document.getElementById('r').addEventListener('click', (e) => window.bar.reload(e.shiftKey));
  window.bar.onTitle((t) => { document.getElementById('t').textContent = t || 'GeoChecker'; });
</script>`;

function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 420, minHeight: 500,
    title: 'GeoChecker', icon: path.join(__dirname, 'icon.png'), backgroundColor: '#0e1418', autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#141b21', symbolColor: '#e6edf3', height: BAR_H }, // 右端の最小化・最大化・閉じるのボタン
  });
  const bar = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  const site = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'site-preload.js') } });
  win.contentView.addChildView(site);
  win.contentView.addChildView(bar);
  const layout = () => {
    const { width, height } = win.getContentBounds();
    bar.setBounds({ x: 0, y: 0, width, height: BAR_H });
    site.setBounds({ x: 0, y: BAR_H, width, height: Math.max(0, height - BAR_H) });
  };
  layout();
  ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'].forEach((ev) => win.on(ev, layout));
  bar.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(barHtml));

  const wc = site.webContents;
  wc.loadURL(SITE);
  wc.on('page-title-updated', (_e, t) => { win.setTitle(t); if (!bar.webContents.isDestroyed()) bar.webContents.send('title', t); });
  // 別のサイトへのリンク（Google マップ・Plonkit など）は、アプリの子ウィンドウで開く。このサイトの中は、そのままアプリで開く
  const handleOpen = (parent) => ({ url }) => {
    let u;
    try { u = new URL(url); } catch { return { action: 'deny' }; }
    if (u.host === ownHost && parent === win) return { action: 'allow' };
    if (!/^https?:$/.test(u.protocol)) { shell.openExternal(url); return { action: 'deny' }; } // mailto: など
    openChild(parent, url);
    return { action: 'deny' };
  };
  const openChild = (parent, url) => {
    const child = new BrowserWindow({
      width: 1100, height: 800, parent: win, title: 'GeoChecker', icon: path.join(__dirname, 'icon.png'), backgroundColor: '#ffffff', autoHideMenuBar: true,
    });
    child.setMenuBarVisibility(false);
    child.webContents.setWindowOpenHandler(handleOpen(child)); // 子ウィンドウの中のリンクも、新しい子ウィンドウで開く
    child.webContents.on('page-title-updated', (_e, t) => child.setTitle(t));
    child.loadURL(url);
  };
  wc.setWindowOpenHandler(handleOpen(win));
  wc.on('did-fail-load', (_e, code, desc, _url, isMain) => {
    if (!isMain || code === -3) return;
    wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<body style="font:16px sans-serif;background:#0e1418;color:#e6edf3;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>サイトに接続できません</h2><p>${desc}</p><p>ネットワークを確認して、上の再読み込みボタン（Ctrl+R）を押してください。</p></div></body>`));
  });
  // ストリートビューのウィンドウ（Google の埋め込み）の中の「Google マップで見る」のリンクは、今いる地点の URL。
  // このアプリ（Electron）なら、別のサイトの iframe の中でも読み取れるので、アプリ本体から頼まれたときに返す
  // Discord Rich Presence: サイトから、今見ているタブなどを受け取って、Discord に出す（null なら消す）
  ipcMain.on('presence', (e, data) => {
    if (e.sender !== wc) return;
    const str = (t) => (typeof t === 'string' && t.trim().length >= 2 ? t.trim().slice(0, 120) : undefined);
    presence.set(data && str(data.details) ? { details: str(data.details), state: str(data.state), timestamps: { start: appStart } } : null);
  });
  ipcMain.handle('app-version', (e) => (e.sender === wc ? app.getVersion() : null)); // 更新の通知用（Windows 版アプリ本体の版）
  ipcMain.handle('sv-position', async (e, hint) => {
    if (e.sender !== wc) return null;
    try {
      const frames = wc.mainFrame.framesInSubtree.filter((f) => /^https:\/\/www\.google\.[a-z.]+\/maps\/embed/.test(f.url));
      if (!frames.length) return null;
      // 複数のストリートビューのウィンドウがあるときは、開いたときの地点（hint）が URL に入っている映像を選ぶ
      let frame = frames[0];
      const named = hint?.name ? frames.find((f) => f.name === hint.name) : null; // ウィンドウごとの映像の名前（iframe の name）で、確実に見分ける
      if (named) frame = named;
      else if (hint && hint.lat != null && frames.length > 1) {
        const near = (f) => { const m = /!1d(-?[\d.]+)!2d(-?[\d.]+)/.exec(f.url); return m ? Math.abs(Number(m[1]) - hint.lat) + Math.abs(Number(m[2]) - hint.lng) : Infinity; };
        frame = frames.slice().sort((a, b) => near(a) - near(b))[0];
      }
      return await frame.executeJavaScript(`(() => {
        const links = [...document.querySelectorAll('a[href*="/maps/@"]')];
        const a = links.find((x) => /マップ|Maps/i.test(x.textContent)) || links[0];
        return a ? a.href : null;
      })()`);
    } catch { return null; }
  });
  // 再読み込み: ボタン・Ctrl+R・F5（Shift を足すとキャッシュも捨てる）
  const reload = (hard) => { const u = wc.getURL(); if (!u || u.startsWith('data:')) wc.loadURL(SITE); else if (hard) wc.reloadIgnoringCache(); else wc.reload(); };
  ipcMain.on('reload', (e, hard) => { if (e.sender === bar.webContents) reload(hard); });
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r')) { e.preventDefault(); reload(input.shift); }
  });
}

// 自動更新: 起動したときに、新しい版（公開の GitHub Releases）があれば裏でダウンロードして、終了時に入れ替える。インストール版だけ（開発中の npm start では動かさない）
function setupAutoUpdate() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox({ type: 'info', buttons: ['今すぐ再起動して更新', '後で（終了時に更新）'], defaultId: 0, cancelId: 1, title: 'GeoChecker の更新', message: `新しい版 ${info.version} をダウンロードしました。`, detail: '再起動すると更新されます。「後で」を選んでも、アプリを終了したときに更新されます。' })
      .then((r) => { if (r.response === 0) autoUpdater.quitAndInstall(); });
  });
  autoUpdater.on('error', () => { /* オフラインなどは無視（次の起動でまた確認する） */ });
  autoUpdater.checkForUpdates().catch(() => {});
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdate();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', () => presence.close());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
