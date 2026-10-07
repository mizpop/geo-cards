// 画面左下の「しまってあるウィンドウ」の一覧（dock.html）から、本体への橋渡し
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dock', {
  list: () => ipcRenderer.invoke('dock-list'),
  onList: (fn) => ipcRenderer.on('dock-list', (_e, items) => fn(items)),
  restore: (id, pos) => ipcRenderer.send('dock-restore', id, pos || null), // pos: ドラッグで離した画面上の位置 { x, y }（なければ、しまう前の位置）
  drag: (on) => ipcRenderer.send('dock-drag', !!on), // ドラッグの間は、一覧のウィンドウを画面いっぱいに広げて、カードが画面のどこへでも動くように
  close: (id) => ipcRenderer.send('dock-close', id),
  hide: () => ipcRenderer.send('dock-hide'),
});
