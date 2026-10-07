// 保存した Plonkit の画像を、見た目がほぼ変わらない程度に圧縮する（WebP・品質 85・幅は最大 2000px）。小さくならなかったものは、そのまま
// 使い方: node scripts/compress-plonkit-images.mjs [入力（初期値 ../plonkit-images）] [出力（初期値 ../plonkit-images-opt）]  ※ sharp が必要（npm i sharp）。環境によっては、sharp の読み込みが止まることがあり、その場合は Windows 側の Node で実行する。sharp の場所は、環境変数 SHARP_FROM に package.json のパスで指定できる
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(process.env.SHARP_FROM || import.meta.url);
const sharp = require('sharp');
const inDir = path.resolve(process.argv[2] || new URL('../../plonkit-images', import.meta.url).pathname);
const outDir = path.resolve(process.argv[3] || new URL('../../plonkit-images-opt', import.meta.url).pathname);
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (!e.name.startsWith('_')) files.push(p); } })(inDir);
let before = 0; let after = 0; let n = 0;
const work = async (f) => {
  const out = path.join(outDir, path.relative(inDir, f));
  if (fs.existsSync(out)) { n++; return; } // 済みのものは飛ばす（途中から再開できる）
  const src = fs.readFileSync(f);
  before += src.length;
  let buf = src;
  try {
    const meta = await sharp(src, { animated: true }).metadata();
    if (!(meta.pages > 1)) { // アニメーションは、そのまま
      const enc = await sharp(src).rotate().resize({ width: 2000, withoutEnlargement: true }).webp({ quality: 85, effort: 5, smartSubsample: true }).toBuffer();
      if (enc.length < src.length * 0.95) buf = enc;
    }
  } catch { /* 読めないものは、そのまま */ }
  after += buf.length;
  if (!fs.existsSync(out) || fs.statSync(out).size !== buf.length) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, buf); }
  if (++n % 200 === 0) console.log(`${n}/${files.length} ${Math.round(before / 1e6)}MB → ${Math.round(after / 1e6)}MB`);
};
const queue = [...files];
await Promise.all(Array.from({ length: 4 }, async () => { for (let f; (f = queue.pop());) await work(f); }));
console.log(`完了 ${n} 枚: ${(before / 1e6).toFixed(1)}MB → ${(after / 1e6).toFixed(1)}MB（${Math.round((1 - after / before) * 100)}% 減）`);
