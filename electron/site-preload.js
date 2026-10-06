// 公開サイト（アプリの本体）に、Windows 版だけの機能を渡す橋渡し
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  // ストリートビューのウィンドウ（Google の埋め込み）の中の「Google マップで見る」のリンク（今いる地点の URL）を読み取る。なければ null
  getSvPosition: () => ipcRenderer.invoke('sv-position'),
});
