// GeoChecker のデスクトップ版: 公開中のサイトを読み込むだけの入れ物。サイトを更新すれば、このアプリにも自動で反映される
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const SITE = 'https://geo-cards-533.pages.dev/';
const ownHost = new URL(SITE).host;

function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 420, minHeight: 500,
    title: 'GeoChecker', icon: path.join(__dirname, 'icon.png'), backgroundColor: '#0e1418', autoHideMenuBar: true,
  });
  win.loadURL(SITE);
  // 別のサイトへのリンク（Google マップ・Plonkit など）は、既定のブラウザで開く。このサイトの中は、そのままアプリで開く
  win.webContents.setWindowOpenHandler(({ url }) => {
    try { if (new URL(url).host === ownHost) return { action: 'allow' }; } catch { /* 無視 */ }
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-fail-load', (_e, code, desc, _url, isMain) => {
    if (!isMain || code === -3) return;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<body style="font:16px sans-serif;background:#0e1418;color:#e6edf3;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>サイトに接続できません</h2><p>${desc}</p><p>ネットワークを確認して、Ctrl+R で再読み込みしてください。</p></div></body>`));
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
