// 画像の圧縮・クリップボード読み込み

// 長辺 maxSide に縮小して WebP（非対応ブラウザでは JPEG）に変換
export async function compressImage(blob, maxSide = 1600, quality = 0.82) {
  const bitmap = await loadBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  if (bitmap.close) bitmap.close();

  let out = await new Promise((res) => canvas.toBlob(res, 'image/webp', quality));
  if (!out || out.type !== 'image/webp') {
    out = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  }
  if (!out) throw new Error('画像の変換に失敗しました');
  return out;
}

// 一覧・地図のサムネイル用の低画質版（長辺 480px・WebP 画質 0.6。元の 1/10 ほどの大きさ）
export const THUMB_SIDE = 480;
export const makeThumb = (blob) => compressImage(blob, THUMB_SIDE, 0.6);

async function loadBitmap(blob) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(blob); } catch { /* 下のフォールバックへ */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// クリップボードから画像を取得。画像がなければ null
export async function readClipboardImage() {
  if (!navigator.clipboard || !navigator.clipboard.read) {
    throw new Error('このブラウザはボタンからの貼り付けに対応していません。Ctrl+V（⌘+V）で貼り付けてください');
  }
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith('image/'));
    if (type) return await item.getType(type);
  }
  return null;
}

export function extFromType(type) {
  if (type === 'image/webp') return 'webp';
  if (type === 'image/png') return 'png';
  return 'jpg';
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return await res.blob();
}
