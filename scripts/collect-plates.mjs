// Wikimedia Commons から、国ごと・地域ごとの、ナンバープレートの画像を集めて、data/region-plates.json に保存する（アプリは、この保存したデータを読み込む）。
//   node scripts/collect-plates.mjs <出力ファイル> <国名の JSON（コード → 英語名の配列）> [国コード ...]
// 地域ごとのカテゴリー（「License plates of ○○」）がある国だけ、集まる。現行・今でも使われていそうなもの（古い年・歴史的・外交官用・トレーラーなどを除く）だけを残す。
// Commons の API は、続けて呼びすぎないよう、1 回ずつ、間をあけて呼ぶ。途中で止めても、出力ファイルから、続きを再開できる。
import fs from 'node:fs';
import crypto from 'node:crypto';

const [, , OUT, NAMES, ...only] = process.argv;
const names = JSON.parse(fs.readFileSync(NAMES, 'utf8'));
const UA = 'GeoChecker-plate-collector/1.0 (personal study app; https://geo-cards-533.pages.dev)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function api(params, tries = 6) {
  for (let k = 0; k < tries; k++) {
    const wait = last + 900 - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const q = new URLSearchParams({ format: 'json', maxlag: '5', ...params });
    try {
      const r = await fetch(`https://commons.wikimedia.org/w/api.php?${q}`, { headers: { 'user-agent': UA } });
      const t = await r.text();
      let j; try { j = JSON.parse(t); } catch { await sleep(8000 * (k + 1)); continue; }
      if (j.error?.code === 'maxlag') { await sleep(6000); continue; }
      return j;
    } catch { await sleep(5000 * (k + 1)); }
  }
  return {};
}
async function members(title, type) {
  const out = [];
  let cont = {};
  for (let i = 0; i < 6; i++) {
    const j = await api({ action: 'query', list: 'categorymembers', cmtitle: title, cmtype: type, cmlimit: '200', ...cont });
    out.push(...(j.query?.categorymembers || []).map((x) => x.title));
    if (!j.continue) break;
    cont = j.continue;
  }
  return out;
}
const BAD_CAT = /diplomatic|consular|military|army|police|trailer|temporary|historic|former|vintage|old |defunct|obsolete|dealer|test|export|taxi|disabled|motorcycle|moped|bicycle|by year|by type|by color|by colour|by design|personali[sz]ed|vanity|specialty|special|number plate|template|map|stamp|sticker|collection|stub|before|under construction|pre-/i;
const REGION_RE = /^Category:(?:License|Licence|Vehicle registration|Registration|Number) plates? of (?:the )?(.+)$/i;
const GENERIC_BY = / by (state|states|prefecture|prefectures|province|provinces|region|regions|county|counties|canton|cantons|district|districts|department|departments|oblast|territory|territories|municipality|autonomous|community|communities|governorate|emirate|federal|land|länder|voivodeship|parish|island|islands)/i;
const BAD_FILE = /\bmap\b|altes|alte |tractor|traktor|agricultur|defaced|pixeli|blurred|censored|diplomatic|trailer|police|patrol|motor show|logo|stamp|sticker|coin|badge|flag of|coat of arms|historic|vintage|\bold\b|former|defunct|dealer|temporary|test plate|export|moped|motorcycle|scooter|bicycle|\.svg|\.pdf|\.tif/i;
const PLATE_FILE = /plate|licen[cs]e|registration|kennzeichen|kenteken|plaque|targa|matr[ií]cula|placa|rejestracyjn|nummerskylt|nummerplate|nummernschild|tablica|ナンバー|номер/i;
const year = (t) => Math.max(0, ...((t.match(/\b(19|20)\d\d\b/g) || []).map(Number)));

// 画像の置き場（upload.wikimedia.org）の、縮小画像の URL（Commons の決まった形: ファイル名の MD5 の先頭 1 文字 / 2 文字）
function thumb(title, w = 330) {
  const name = title.replace(/^File:/, '').replace(/ /g, '_');
  const h = crypto.createHash('md5').update(name).digest('hex');
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${h[0]}/${h.slice(0, 2)}/${encodeURIComponent(name).replace(/%2F/g, '/')}/${w}px-${encodeURIComponent(name)}`;
}

const result = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { _meta: {}, plates: {} };
const save = () => fs.writeFileSync(OUT, JSON.stringify(result));

async function regionCats(country) {
  const roots = [];
  const ns = [...new Set((names[country] || []).flatMap((n) => [n, /^(United|Netherlands|Philippines|Bahamas|Gambia|Czech|Central|Democratic|Republic|Comoros|Maldives|Seychelles|Marshall|Solomon|Cayman)/.test(n) ? `the ${n}` : n]))];
  for (const n of ns) for (const p of ['License plates of', 'Vehicle registration plates of']) roots.push(`Category:${p} ${n}`);
  const found = new Map(); // 地域名 → カテゴリー
  for (const root of [...new Set(roots)]) {
    const subs = await members(root, 'subcat');
    for (const sc of subs) {
      if (GENERIC_BY.test(sc)) { // 「… by prefecture」のような、地域ごとの入れ物は、一段下へ
        for (const s2 of await members(sc, 'subcat')) { const m = REGION_RE.exec(s2); if (m && !BAD_CAT.test(s2)) found.set(m[1], s2); }
      } else { const m = REGION_RE.exec(sc); if (m && !BAD_CAT.test(sc)) found.set(m[1], sc); }
    }
    if (found.size) break; // この国の、地域ごとのカテゴリーが見つかった
  }
  return found;
}

const countries = only.length ? only : Object.keys(names);
for (const cc of countries) {
  if (result.plates[cc] || result._meta[cc]) { continue; } // 済み
  let regs;
  try { regs = await regionCats(cc); } catch { regs = new Map(); }
  const out = {};
  for (const [region, cat] of regs) {
    const files = (await members(cat, 'file')).filter((f) => /\.(jpe?g|png)$/i.test(f) && PLATE_FILE.test(f) && !BAD_FILE.test(f));
    const cur = files.filter((f) => { const y = year(f); return !y || y >= 2000; }).sort((a, b) => year(b) - year(a)).slice(0, 6);
    if (cur.length) out[region] = cur.map((f) => ({ t: f.replace(/^File:/, ''), u: thumb(f), y: year(f) || undefined }));
  }
  if (Object.keys(out).length) result.plates[cc] = out;
  result._meta[cc] = { regions: regs.size, withPlates: Object.keys(out).length };
  console.log(cc, regs.size, Object.keys(out).length);
  save();
}
console.log('done');
