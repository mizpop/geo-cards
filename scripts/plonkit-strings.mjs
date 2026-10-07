// 翻訳しやすいように、Plonkit の文字を「キー → 英語の文」の平らな JSON に書き出す / 翻訳したものを、元の構造に戻す
//   書き出し: node scripts/plonkit-strings.mjs export   → data/plonkit-strings-en.json（キー: "japan/3/12/0" = 国/段/項目/行）
//   取り込み: node scripts/plonkit-strings.mjs import data/plonkit-strings-ja.json
//              → data/plonkit-ja.json（構造は plonkit-en.json と同じで、文字だけ日本語）と、圧縮した data/plonkit-ja.json.gz
// 翻訳のとき: キーは変えない。値の中の Markdown（**太字**、行頭の「- 」、[文字](URL)）と URL はそのまま、文字だけ翻訳する
import fs from 'fs';
import zlib from 'zlib';
const d = (f) => new URL(`../data/${f}`, import.meta.url);
const guides = JSON.parse(fs.readFileSync(d('plonkit-en.json'), 'utf8'));
// 各文字列に、キーを付けて順に渡す
function walk(fn) {
  for (const [slug, g] of Object.entries(guides)) {
    g.steps.forEach((s, si) => {
      s.title = fn(`${slug}/${si}/t`, s.title);
      s.items.forEach((it, ii) => {
        if (it.k === 'div') it.title = fn(`${slug}/${si}/${ii}/t`, it.title);
        else if (it.k === 'tip') it.text = it.text.map((t, li) => fn(`${slug}/${si}/${ii}/${li}`, t));
      });
    });
  }
}
const mode = process.argv[2];
if (mode === 'export') {
  const out = {};
  walk((k, t) => { if (/[A-Za-z]{2}/.test(t)) out[k] = t; return t; });
  fs.writeFileSync(d('plonkit-strings-en.json'), JSON.stringify(out, null, 1));
  console.log(Object.keys(out).length, '文 /', Object.values(out).join('').length, '文字');
} else if (mode === 'import') {
  const ja = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  let n = 0;
  let miss = 0;
  walk((k, t) => { if (typeof ja[k] === 'string') { n++; return ja[k]; } if (/[A-Za-z]{2}/.test(t)) miss++; return t; });
  for (const g of Object.values(guides)) { g.lang = 'ja'; g.translated = true; }
  const json = JSON.stringify(guides);
  fs.writeFileSync(d('plonkit-ja.json'), json);
  fs.writeFileSync(d('plonkit-ja.json.gz'), zlib.gzipSync(json, { level: 9 }));
  console.log(`翻訳を反映: ${n} 文 / 未翻訳（英語のまま）: ${miss} 文`);
} else console.log('使い方: node scripts/plonkit-strings.mjs export | import <翻訳した JSON>');
