// Plonkit のガイドの画像を、すべてこの PC に保存する（再開できる）。使い方: node scripts/mirror-plonkit-images.mjs [保存先（初期値 ../plonkit-images）]
// Plonkit は短時間の連続した取得を断る（約 9 枚のあと 429・Retry-After 10 秒）ので、断られたら待って続ける。全部で 2 時間ほどかかる
import fs from 'fs';
import path from 'path';
const root = path.resolve(process.argv[2] || new URL('../../plonkit-images', import.meta.url).pathname);
const guides = JSON.parse(fs.readFileSync(new URL('../data/plonkit-en.json', import.meta.url), 'utf8'));
const all = [...new Set(Object.values(guides).flatMap((g) => [g.hero, ...g.steps.flatMap((s) => s.items.map((i) => i.img))]).filter((u) => u && u.startsWith('/')))];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failed = [];
let done = 0;
let skipped = 0;
const t0 = Date.now();
for (const u of all) {
  const file = path.join(root, u);
  if (fs.existsSync(file)) { skipped++; continue; }
  for (let tries = 0; tries < 8; tries++) {
    const r = await fetch(`https://www.plonkit.net${encodeURI(u)}`, { headers: { referer: 'https://www.plonkit.net/', 'user-agent': 'Mozilla/5.0 (GeoChecker image mirror)' } }).catch(() => null);
    if (r?.status === 429) { await sleep((Number(r.headers.get('retry-after')) || 10) * 1000 + 500); continue; }
    if (r?.ok && (r.headers.get('content-type') || '').startsWith('image/')) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      done++;
    } else { failed.push(`${u} ${r?.status}`); }
    break;
  }
  if ((done + failed.length) % 50 === 0) console.log(`${done + skipped}/${all.length} 取得済み（失敗 ${failed.length}）経過 ${Math.round((Date.now() - t0) / 60000)} 分`);
  await sleep(300);
}
fs.writeFileSync(path.join(root, '_failed.txt'), failed.join('\n'));
console.log(`完了: 取得 ${done} / 既存 ${skipped} / 失敗 ${failed.length}`);
