// Plonkit の画像を、CDN（jsDelivr）に、先に読み込ませておく（初めて取りに行く画像は、1〜4 秒かかるため。一度取れば、速い）。
// 使い方: node scripts/warm-plonkit-images.mjs [同時の数（初期値 8）]   ※ js/plonkit.js の CDN と同じコミットを使う
import fs from 'fs';
const conc = Math.max(1, Number(process.argv[2]) || 8);
const src = fs.readFileSync(new URL('../js/plonkit.js', import.meta.url), 'utf8');
const CDN = /const CDN = '([^']+)'/.exec(src)[1];
const notIn = new Set(JSON.parse(/new Set\((\[.*?\])\);/s.exec(src)[1]));
const guides = JSON.parse(fs.readFileSync(new URL('../data/plonkit-en.json', import.meta.url), 'utf8'));
const all = [...new Set(Object.values(guides).flatMap((g) => [g.hero, ...g.steps.flatMap((s) => s.items.map((i) => i.img))]).filter((u) => u && u.startsWith('/images/') && !notIn.has(u)))];
const key = (u) => { let k = u.slice('/images/'.length); try { k = decodeURI(k); } catch { /* そのまま */ } return CDN + encodeURI(k.replace(/\.[A-Za-z0-9]+$/, '') + '.webp'); };
let i = 0; let ok = 0; let ng = 0; const t0 = Date.now();
const worker = async () => {
  for (; i < all.length;) {
    const u = all[i++];
    try { const r = await fetch(key(u), { signal: AbortSignal.timeout(30000) }); await r.arrayBuffer(); if (r.ok) ok++; else ng++; } catch { ng++; }
    if ((ok + ng) % 200 === 0) console.log(`${ok + ng}/${all.length}（失敗 ${ng}）${Math.round((Date.now() - t0) / 1000)} 秒`);
  }
};
await Promise.all(Array.from({ length: conc }, worker));
console.log(`完了: ${ok} 枚 / 失敗 ${ng} / ${Math.round((Date.now() - t0) / 1000)} 秒`);
