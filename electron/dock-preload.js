// 画面左下の「しまってあるウィンドウ」の一覧（dock.html）から、本体への橋渡し
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dock', {
  list: () => ipcRenderer.invoke('dock-list'),
  onList: (fn) => ipcRenderer.on('dock-list', (_e, items) => fn(items)),
  restore: (id) => ipcRenderer.send('dock-restore', id),
  close: (id) => ipcRenderer.send('dock-close', id),
  hide: () => ipcRenderer.send('dock-hide'),
});
