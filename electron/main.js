// GeoChecker のデスクトップ版: 公開中のサイトを読み込むだけの入れ物。サイトを更新すれば、このアプリにも自動で反映される
// 上の細いバー（タイトルバー）に再読み込みボタンを置くため、バーとサイトを別々の画面（WebContentsView）にしている
const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, globalShortcut, desktopCapturer, screen, Tray, Menu, nativeImage, Notification } = require('electron');
const fs = require('fs');
const path = require('path');
const { DiscordPresence } = require('./discord');

const SITE = process.env.GEOCHECKER_SITE || 'https://geo-cards-533.pages.dev/'; // GEOCHECKER_SITE: 開発・動作確認用に、読み込む先を変える
const ownHost = new URL(SITE).host;
const BAR_H = 36;
const DISCORD_CLIENT_ID = '1557091296546652160'; // Discord のアプリケーション ID（Rich Presence 用。公開してよい ID）
// 大きな画像: 公開サイトのアプリのアイコン（Discord が URL から取り込む。開発者ポータルに画像を登録しなくてよい）
const DISCORD_IMAGE = 'https://geo-cards-533.pages.dev/icons/icon-512.png';
const presence = new DiscordPresence(DISCORD_CLIENT_ID);
const appStart = Date.now();
let quitting = false; // 終了するとき（トレイの「終了」・更新・OS の終了）だけ true。それ以外で × を押したときは、閉じずにバックグラウンドへ

const barHtml = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#141b21;color:#e6edf3;font:13px 'Segoe UI','Yu Gothic UI',sans-serif;user-select:none}
  body{display:flex;align-items:center;-webkit-app-region:drag;padding-left:12px;box-sizing:border-box}
  #t{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;opacity:.85}
  /* 右端の最小化・最大化・閉じるのボタン（約 140px）の左に置く */
  #r{-webkit-app-region:no-drag;margin-right:146px;width:30px;height:26px;display:grid;place-items:center;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer}
  #p{-webkit-app-region:no-drag;margin-right:4px;width:30px;height:26px;display:grid;place-items:center;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;opacity:.7}
  #p.on{opacity:1;color:#34f0a0;background:#34f0a022}
  #u{-webkit-app-region:no-drag;margin-right:4px;height:26px;display:flex;align-items:center;gap:6px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;font-size:12px;opacity:.85}
  #u svg{flex:none}#u.busy svg{animation:sp 1s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
  #u.ready{opacity:1;color:#06140d;background:#34f0a0;font-weight:700}#u.error{color:#ff8a8a}#u.latest{color:#34f0a0}
  #u:hover,#r:hover,#p:hover{background:#2a3640}#u.ready:hover{background:#5af6b4}#r:active{background:#34f0a022}
</style><div id="t">GeoChecker</div>
<button id="u" title="クライアントの更新を確認する（新しい版があれば、ダウンロードして、ここから更新できます）" aria-label="更新を確認"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg><span id="us">更新を確認</span></button>
<button id="p" title="最前面に固定（ほかのアプリの上に常に表示。ゲームを見ながら使うとき）" aria-label="最前面に固定"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5M9 3h6l-1 6 3 3H7l3-3z"/></svg></button>
<button id="r" title="再読み込み（Ctrl+R）／ Shift を押しながらで、キャッシュも捨てて読み込み直す" aria-label="再読み込み"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg></button>
<script>
  document.getElementById('r').addEventListener('click', (e) => window.bar.reload(e.shiftKey));
  document.getElementById('p').addEventListener('click', () => window.bar.togglePin());
  const u = document.getElementById('u'); const us = document.getElementById('us'); let ut = null;
  u.addEventListener('click', () => window.bar.checkUpdate());
  window.bar.onUpdate((d) => {
    clearTimeout(ut);
    u.className = d.state === 'checking' || d.state === 'downloading' ? 'busy' : d.state === 'downloaded' ? 'ready' : d.state === 'error' ? 'error' : d.state === 'latest' ? 'latest' : '';
    u.title = d.text || '更新を確認';
    us.textContent = d.state === 'downloaded' ? '更新して再起動' : d.state === 'downloading' ? (d.text || '').replace('ダウンロード中… ', '') : d.state === 'checking' ? '確認中…' : d.state === 'latest' ? '最新です' : d.state === 'error' ? '確認できません' : d.state === 'dev' ? '開発版' : '更新を確認';
    if (d.state === 'latest' || d.state === 'error' || d.state === 'dev') ut = setTimeout(() => { u.className = ''; us.textContent = '更新を確認'; u.title = '更新を確認'; }, 6000);
  });
  window.bar.onPin((on) => document.getElementById('p').classList.toggle('on', on));
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
    presence.set(data && str(data.details) ? { details: str(data.details), state: str(data.state), timestamps: { start: appStart }, assets: { large_image: DISCORD_IMAGE, large_text: 'GeoChecker（GeoGuessr 学習アプリ）' } } : null);
  });
  ipcMain.handle('presence-status', (e) => (e.sender === wc ? presence.status : null)); // 設定の画面に、Discord につながっているかを出す
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
  barContents = bar.webContents;
  bar.webContents.on('did-finish-load', () => bar.webContents.send('update', updateInfo));
  ipcMain.on('check-update', (e) => { if (e.sender === bar.webContents) manualUpdateCheck(); });
  ipcMain.on('reload', (e, hard) => { if (e.sender === bar.webContents) reload(hard); });
  // ---- Windows 版だけの機能: 最前面に固定・どのアプリを見ていても使えるショートカット・画面の取り込み・タスクトレイ ----
  const prefsFile = path.join(app.getPath('userData'), 'prefs.json');
  const prefs = (() => { try { return JSON.parse(fs.readFileSync(prefsFile, 'utf8')); } catch { return {}; } })();
  const savePrefs = () => { try { fs.writeFileSync(prefsFile, JSON.stringify(prefs)); } catch { /* 保存できなくても動く */ } };
  const sendPin = () => { if (!bar.webContents.isDestroyed()) bar.webContents.send('pin', win.isAlwaysOnTop()); if (!wc.isDestroyed()) wc.send('pin', win.isAlwaysOnTop()); };
  const setPin = (on) => { win.setAlwaysOnTop(!!on, 'floating'); prefs.pin = !!on; savePrefs(); sendPin(); updateTray?.(); };
  if (prefs.pin) win.setAlwaysOnTop(true, 'floating');
  bar.webContents.on('did-finish-load', sendPin);
  ipcMain.on('toggle-pin', (e) => { if (e.sender === bar.webContents) setPin(!win.isAlwaysOnTop()); });
  ipcMain.handle('get-pin', (e) => (e.sender === wc ? win.isAlwaysOnTop() : null));
  ipcMain.on('set-pin', (e, on) => { if (e.sender === wc) setPin(on); });
  const showWin = () => { if (win.isMinimized()) win.restore(); win.show(); win.focus(); };
  const toggleWin = () => { if (win.isVisible() && win.isFocused()) win.hide(); else showWin(); };
  // 画面の取り込み: マウスのある画面を撮って、アプリのカードの作成画面へ（自分のウィンドウは、一瞬だけ透明にして写さない）
  const captureScreen = async () => {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const wasVisible = win.isVisible();
    const op = win.getOpacity();
    if (wasVisible) { win.setOpacity(0); await new Promise((r) => setTimeout(r, 120)); }
    try {
      const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
      const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
      const src = srcs.find((x) => String(x.display_id) === String(d.id)) || srcs[0];
      if (!src || src.thumbnail.isEmpty()) throw new Error('画面を取り込めませんでした');
      return src.thumbnail.toDataURL();
    } finally { if (wasVisible) win.setOpacity(op || 1); }
  };
  const captureToApp = async () => {
    try {
      const url = await captureScreen();
      showWin();
      if (!wc.isDestroyed()) wc.send('capture', url);
    } catch (err) { new Notification({ title: 'GeoChecker', body: String(err.message || err) }).show(); }
  };
  ipcMain.handle('capture-screen', async (e) => { if (e.sender !== wc) return null; await captureToApp(); return true; });
  const regs = [['CommandOrControl+Alt+S', captureToApp], ['CommandOrControl+Alt+G', toggleWin]];
  const failed = regs.filter(([k, fn]) => { try { return !globalShortcut.register(k, fn); } catch { return true; } }).map(([k]) => k);
  ipcMain.handle('shortcut-status', (e) => (e.sender === wc ? { failed } : null));
  win.on('closed', () => { regs.forEach(([k]) => globalShortcut.unregister(k)); tray?.destroy(); });
  // タスクトレイ: クリックで表示 / 隠す
  let tray = null;
  let updateTray = null;
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 16, height: 16 }));
    tray.setToolTip('GeoChecker（クリックで表示 / 隠す）');
    tray.on('click', toggleWin);
    updateTray = () => tray?.setContextMenu(Menu.buildFromTemplate([
      { label: '表示 / 隠す（Ctrl+Alt+G）', click: toggleWin },
      { label: '画面を取り込んでカードにする（Ctrl+Alt+S）', click: captureToApp },
      { label: '最前面に固定', type: 'checkbox', checked: win.isAlwaysOnTop(), click: (i) => setPin(i.checked) },
      { type: 'separator' },
      { label: '終了', click: () => app.quit() },
    ]));
    updateTray();
  } catch { /* トレイが使えなくても動く */ }
  // × ボタンで閉じても、終了せずにタスクトレイに残る（Discord の表示・ショートカットも動き続ける）。終了は、トレイのメニューの「終了」
  win.on('close', (e) => {
    if (quitting || !tray) return; // トレイが使えないときは、普通に閉じる（隠すと、戻せなくなるため）
    e.preventDefault();
    win.hide();
    if (!prefs.bgNoticed) { // 最初の 1 回だけ、バックグラウンドで動いていることを知らせる
      prefs.bgNoticed = true; savePrefs();
      new Notification({ title: 'GeoChecker', body: 'バックグラウンドで動いています。タスクトレイのアイコンから、開く・終了ができます（Ctrl+Alt+G でも表示できます）' }).show();
    }
  });
  win.on('session-end', () => { quitting = true; });
  // ウィンドウを外に出す（アプリ内のカード・国・Plonkit などのウィンドウを、独立した Windows のウィンドウで開く）
  const openPopout = (entry, size) => {
    const w = new BrowserWindow({
      width: Math.max(420, Math.min(1600, Math.round(size?.width) || 900)), height: Math.max(360, Math.min(1200, Math.round(size?.height) || 760)),
      minWidth: 360, minHeight: 300, title: 'GeoChecker', icon: path.join(__dirname, 'icon.png'), backgroundColor: '#0e1418', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'site-preload.js') },
    });
    w.webContents.setWindowOpenHandler(handleOpen(w));
    w.webContents.on('page-title-updated', (_e, t) => w.setTitle(t));
    w.loadURL(`${SITE}${SITE.includes('?') ? '&' : '?'}popout=${encodeURIComponent(JSON.stringify(entry))}`);
  };
  ipcMain.handle('popout', (e, data) => {
    if (!data?.entry || (e.sender !== wc && !BrowserWindow.fromWebContents(e.sender))) return false;
    openPopout(data.entry, data.size);
    return true;
  });
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r')) { e.preventDefault(); reload(input.shift); }
  });
}

// 自動更新: 起動したときに、新しい版（公開の GitHub Releases）があれば裏でダウンロードして、終了時に入れ替える。インストール版だけ（開発中の npm start では動かさない）
// 更新の状態をバー（上の細い画面）に伝える: { state: 'idle' | 'checking' | 'downloading' | 'downloaded' | 'latest' | 'error' | 'dev', text, percent }
let barContents = null;
let updateInfo = { state: 'idle', text: '' };
let autoUpdater = null;
const pushUpdate = (u) => { updateInfo = u; if (barContents && !barContents.isDestroyed()) barContents.send('update', u); };
const askRestart = (version) => dialog.showMessageBox({ type: 'info', buttons: ['今すぐ再起動して更新', '後で（終了時に更新）'], defaultId: 0, cancelId: 1, title: 'GeoChecker の更新', message: `新しい版${version ? `（${version}）` : ''}をダウンロードしました。再起動して更新しますか？` })
  .then((r) => { if (r.response === 0) { quitting = true; autoUpdater.quitAndInstall(); } });
function setupAutoUpdate() {
  if (!app.isPackaged) return;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => pushUpdate({ state: 'checking', text: '更新を確認しています…' }));
  autoUpdater.on('update-available', (info) => pushUpdate({ state: 'downloading', text: `新しい版 ${info.version} をダウンロード中…`, percent: 0, version: info.version }));
  autoUpdater.on('update-not-available', () => pushUpdate({ state: 'latest', text: `最新の版です（${app.getVersion()}）` }));
  autoUpdater.on('download-progress', (p) => pushUpdate({ state: 'downloading', text: `ダウンロード中… ${Math.round(p.percent)}%`, percent: p.percent, version: updateInfo.version }));
  autoUpdater.on('update-downloaded', (info) => {
    pushUpdate({ state: 'downloaded', text: `新しい版 ${info.version} の準備ができました。押すと再起動して更新します`, version: info.version });
    askRestart(info.version);
  });
  autoUpdater.on('error', (err) => pushUpdate({ state: 'error', text: `更新を確認できませんでした（${String(err?.message || err).split('\n')[0].slice(0, 80)}）` }));
  autoUpdater.checkForUpdates().catch(() => {}); // 起動したときの確認（エラーは、上の error で、バーに出る）
}
// バーのボタン: 準備ができていれば再起動して更新 / 確認中・ダウンロード中は何もしない / それ以外は、今すぐ確認
function manualUpdateCheck() {
  if (!autoUpdater) { pushUpdate({ state: 'dev', text: 'インストール版でだけ、更新できます（開発中の起動では、確認しません）' }); return; }
  if (updateInfo.state === 'downloaded') { askRestart(updateInfo.version); return; }
  if (updateInfo.state === 'checking' || updateInfo.state === 'downloading') return;
  autoUpdater.checkForUpdates().catch(() => {});
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdate();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', () => { quitting = true; presence.close(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && quitting) app.quit(); }); // トレイに残るので、ウィンドウがすべて閉じても、終了しない（終了は、トレイの「終了」）
