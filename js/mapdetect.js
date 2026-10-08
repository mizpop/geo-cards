// 範囲（割合）を黒などで塗りつぶした画像を作る（地図の位置は、人が決める。AI は使わない）
/** 範囲（割合）を、色で塗りつぶした画像（PNG の Blob）を作る */
export async function eraseRegions(blob, regions, color = '#000000') {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0);
  g.fillStyle = color;
  for (const [x, y, w, h] of regions) g.fillRect(Math.floor(x * c.width), Math.floor(y * c.height), Math.ceil(w * c.width), Math.ceil(h * c.height));
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('画像を書き出せませんでした'))), 'image/png'));
}
