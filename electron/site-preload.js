// 公開サイト（アプリの本体）に、Windows 版だけの機能を渡す橋渡し
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  // ストリートビューのウィンドウの「Google マップで見る」が押されたとき、今いる地点の URL を受け取る
  onSvPosition: (fn) => ipcRenderer.on('sv-position', (_e, url) => fn(url)),
});
