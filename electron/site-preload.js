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
});
