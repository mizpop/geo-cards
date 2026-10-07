// Plonkit の全ての国のガイドを取得して、1 つの JSON にまとめる（翻訳用）
// 使い方: node scripts/fetch-plonkit.mjs  → data/plonkit-en.json
import fs from 'fs';
import { extractGuide } from '../functions/api/plonkit.js';
const src = fs.readFileSync(new URL('../js/map.js', import.meta.url), 'utf8');
const slugs = [...new Set([...(/PLONKIT_SLUGS = new Set\(\s*\(?['"`]([^'"`]+)['"`]/.exec(src)[1].split(/\s+/)), 'israel-west-bank'])].filter(Boolean);
const file = new URL('../data/plonkit-en.json', import.meta.url);
const out = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}; // 取得済みのものは飛ばす（途中から再開できる）
const failed = [];
for (const slug of slugs) {
  if (out[slug]) continue;
  try {
    let r;
    for (let i = 0; i < 6; i++) { // 混み合っている（429）ときは、待ってやり直す
      r = await fetch(`https://www.plonkit.net/${slug}`, { headers: { 'user-agent': 'Mozilla/5.0 (GeoChecker data export)' } });
      if (r.status !== 429) break;
      await new Promise((x) => setTimeout(x, 5000 * (i + 1)));
    }
    const g = r.ok ? extractGuide(await r.text()) : null;
    if (!g) throw new Error(String(r.status));
    out[slug] = g;
    console.log('ok', slug, g.steps.reduce((n, s) => n + s.items.length, 0));
  } catch (e) { failed.push(slug); console.log('NG', slug, e.message); }
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  await new Promise((r) => setTimeout(r, 1500));
}
fs.writeFileSync(new URL('../data/plonkit-en.json', import.meta.url), JSON.stringify(out, null, 1));
console.log('完了', Object.keys(out).length, '件 / 失敗', failed.join(' '));
