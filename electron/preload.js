// タイトルバー（上の細い画面）から、本体のページを再読み込みするための橋渡し
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bar', {
  reload: (hard) => ipcRenderer.send('reload', !!hard),
  onTitle: (fn) => ipcRenderer.on('title', (_e, t) => fn(t)),
});
