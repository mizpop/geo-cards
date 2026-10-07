// 公開サイト（アプリの本体）に、Windows 版だけの機能を渡す橋渡し
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  // ストリートビューのウィンドウ（Google の埋め込み）の中の「Google マップで見る」のリンク（今いる地点の URL）を読み取る。なければ null
  getSvPosition: (hint) => ipcRenderer.invoke('sv-position', hint || null),
  // Windows 版アプリ本体の版（更新されて初めて起動したときの通知に使う）
  getAppVersion: () => ipcRenderer.invoke('app-version'),
  // Discord Rich Presence に出す内容（{ details, state }。null で消す）
  setPresence: (data) => ipcRenderer.send('presence', data || null),
  // Discord につながっているか（'ready' など）
  getPresenceStatus: () => ipcRenderer.invoke('presence-status'),
  // 最前面に固定（ほかのアプリの上に常に表示）
  getAlwaysOnTop: () => ipcRenderer.invoke('get-pin'),
  setAlwaysOnTop: (on) => ipcRenderer.send('set-pin', !!on),
  onAlwaysOnTop: (fn) => ipcRenderer.on('pin', (_e, on) => fn(on)),
  // 画面の取り込み（Ctrl+Alt+S でも。どのアプリを見ていても使える）: 撮れた画像（data URL）が届く
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  onCapture: (fn) => ipcRenderer.on('capture', (_e, url) => fn(url)),
  // 外に出したウィンドウの操作（枠がないので、見出しのボタンから）
  winControl: (action) => ipcRenderer.send('win-control', action), // 'minimize' | 'maximize' | 'pin' | 'store' | 'close'
  setWinIcon: (dataUrl) => ipcRenderer.send('win-icon', dataUrl), // タスクバーのアイコン
  getKeys: () => ipcRenderer.invoke('keys-get'), // 全体のショートカットの割り当て { keys, defaults, failed }
  setKey: (action, accel) => ipcRenderer.invoke('keys-set', action, accel), // 'capture' | 'toggle' | 'dock'
  getWinBounds: () => ipcRenderer.invoke('win-bounds'),
  setWinBounds: (b) => ipcRenderer.send('win-set-bounds', b),
  getWinState: () => ipcRenderer.invoke('win-state'),
  onWinState: (fn) => ipcRenderer.on('win-state', (_e, s) => fn(s)),
  returnToApp: (entry) => ipcRenderer.send('popout-return', entry), // アプリの中に戻す
  onReturnToApp: (fn) => ipcRenderer.on('return-to-app', (_e, entry) => fn(entry)), // 本体: 戻ってきた内容を開く
  // このウィンドウを、独立した Windows のウィンドウに出す（entry: 開く内容）
  popOut: (data) => ipcRenderer.invoke('popout', data),
  // 全体のショートカットの登録状況（ほかのアプリと重なって登録できなかったものの一覧）
  getShortcutStatus: () => ipcRenderer.invoke('shortcut-status'),
});
