// 画面左下の「しまってあるウィンドウ」の一覧（dock.html）から、本体への橋渡し
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dock', {
  list: () => ipcRenderer.invoke('dock-list'), // { items, justStored }
  onList: (fn) => ipcRenderer.on('dock-list', (_e, items, justStored) => fn(items, justStored)),
  restore: (id, pos) => ipcRenderer.send('dock-restore', id, pos || null), // pos: ドラッグで離した画面上の位置 { x, y }（なければ、しまう前の位置）
  drag: (on) => ipcRenderer.invoke('dock-drag', !!on), // 画面の左上の位置 { x, y } を返す // ドラッグの間は、一覧のウィンドウを画面いっぱいに広げて、カードが画面のどこへでも動くように
  close: (id) => ipcRenderer.send('dock-close', id),
  onAnim: (fn) => ipcRenderer.on('dock-anim', (_e, kind) => fn(kind)), // 'enter'（下から出る）/ 'leave'（下へ引っ込む）
  hide: () => ipcRenderer.send('dock-hide'),
});
