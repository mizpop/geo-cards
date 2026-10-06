// 世界の都市の検索（地図の検索バー用。キー不要の無料の 2 つのサービスを使う）
//  1. Open-Meteo のジオコーディング: 入力に合わせた候補（日本語の名前・人口つき）。「パリ」「ワルシャワ」「Tokyo」などは見つかるが、
//     「東京」「大阪」「京都」のような漢字だけの名前は見つからないことがある
//  2. OpenStreetMap の Nominatim: Enter や「もっと探す」を押したときだけ問い合わせる（入力のたびには送らない・1 秒に 1 回まで）
//     漢字だけの名前は、「市」を付けた名前（京都 → 京都市）でも探す
// 戻り値の都市: { id, name（日本語）, en（英語）, local（現地の言語）, sub（県・国など）, code（国コード・大文字）, lat, lng, zoom, pop, src }
//   en・local は、OpenStreetMap の結果ならすぐに入り、Open-Meteo の結果は fillNames() で（候補が出たあとに）取りに行く

import { romajiToKana } from './countries.js';
import { COUNTRY_INFO } from './countryinfo.js';

const OM = 'https://geocoding-api.open-meteo.com/v1/search';
const OSM = 'https://nominatim.openstreetmap.org/search';

// 地図を寄せる縮尺（大きな都市ほど引いた縮尺・小さな町ほど寄る）
const zoomForOM = (x) => {
  const f = x.feature_code || '';
  if (f === 'PPLC') return 10;
  if (f === 'ADM1') return 8;
  if (/^ADM[23]/.test(f)) return 9;
  if (f === 'ISL') return 9;
  const pop = x.population || 0;
  return pop > 500000 ? 10 : pop > 100000 ? 11 : pop > 10000 ? 12 : 13;
};
const zoomForOSM = (x) => {
  const t = x.addresstype || x.type || '';
  if (/^(country)$/.test(t)) return 5;
  if (/^(state|province|region)$/.test(t)) return 7;
  if (/^(county|island|state_district)$/.test(t)) return 9;
  if (t === 'city') return 11;
  if (/^(town|municipality|borough)$/.test(t)) return 12;
  if (x.category === 'boundary') return 10;
  return 13;
};
const PLACE_OK = /^(city|town|village|municipality|county|state|province|region|island|borough|suburb|state_district|city_district|district|quarter|neighbourhood|hamlet)$/;
const PLACE_BIG = /^(city|town|village|municipality|county|state|province|region|island|borough|state_district)$/;

// ローマ字の入力も探せるように、検索する言葉を何通りか作る（入力のまま・カタカナ・長音をまとめた形）
//   tokyo / osaka / kyoto → そのまま（英語のローマ字の名前でも、日本語の名前で見つかる）
//   berurin / warushawa / nyuuyooku → ベルリン / ワルシャワ / ニューヨーク（外国の都市のカタカナ名）
//   oosaka / toukyou / kyouto → osaka / tokyo / kyoto（日本の都市の長音の書き方）
// 区切りの多い有名な都市名（Open-Meteo は、ハイフンやスペースが違うと見つけられないため、正しい綴りでも探す）。区切りなし・途中までの入力（portauprince・newyo）でも当たる
const BIG_NAMES = ['New York City', 'Port-au-Prince', 'Los Angeles', 'San Francisco', 'San Diego', 'San Jose', 'San Antonio', 'Las Vegas', 'Salt Lake City', 'New Orleans', 'Washington D.C.', 'Mexico City', 'Rio de Janeiro', 'Sao Paulo', 'Buenos Aires', 'Santo Domingo', 'San Juan', 'San Salvador', 'San Jose Costa Rica', 'Panama City', 'Guatemala City', 'Quebec City', 'Hong Kong', 'Kuala Lumpur', 'Ho Chi Minh City', 'Phnom Penh', 'Abu Dhabi', 'Tel Aviv', 'Cape Town', 'Addis Ababa', 'Dar es Salaam', 'Port Louis', 'Port Moresby', 'Port of Spain', 'Port Elizabeth', 'Santa Fe', 'Santa Cruz', 'La Paz', 'Santiago de Chile', 'Ciudad Juarez', 'Puerto Rico', 'Saint Petersburg', 'Saint Denis', 'Saint-Etienne', 'Aix-en-Provence', 'Stoke-on-Trent', 'Newcastle upon Tyne', 'Frankfurt am Main', 'Rostock', 'Palma de Mallorca', 'Las Palmas', 'Vitoria-Gasteiz', 'Rio Branco', 'Nur-Sultan', 'Ulan Bator', 'Dushanbe', 'Bandar Seri Begawan', 'Colombo', 'Sri Jayawardenepura Kotte', 'New Delhi', 'Navi Mumbai', 'Kuala Terengganu', 'Johor Bahru', 'Kota Kinabalu', 'Alice Springs', 'Gold Coast', 'Wellington', 'Christchurch', 'Tierra del Fuego', 'Punta Arenas', 'Puerto Montt', 'Montego Bay', 'Baton Rouge', 'Oklahoma City', 'Kansas City', 'Virginia Beach', 'Fort Worth', 'St. Louis', 'St. John\'s', 'Mar del Plata', 'Cabo San Lucas', 'Puerto Vallarta', 'Playa del Carmen', 'Santiago de Compostela', 'Villa Nueva', 'Dar Es Salaam', 'Bobo-Dioulasso', 'Ouagadougou', 'Port Harcourt', 'Port Said', 'Port Sudan', 'Port Vila', 'Pointe-Noire', 'Pointe-a-Pitre', 'Fort-de-France', 'Cap-Haitien', 'Pointe-à-Pitre'];
const sepless = (t) => t.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const BIG_KEYS = BIG_NAMES.map((n) => [sepless(n), n]);
function bigNameMatches(joined) {
  const k = sepless(joined);
  if (k.length < 4) return [];
  return BIG_KEYS.filter(([key]) => key.startsWith(k)).map(([, n]) => n).slice(0, 2);
}

export function queryVariants(query) {
  const q = query.normalize('NFKC').trim().replace(/\s+/g, ' ');
  // ハイフン・スペース・ピリオド・中黒などの区切りは、あってもなくても同じ地名として探す（Saint-Denis / Saint Denis / SaintDenis、ニュー ヨーク / ニューヨーク）
  if (/[\s\-‐-―・･.,'’]/.test(q)) {
    const spaced = q.replace(/[\-‐-―・･]+/g, ' ').replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
    const joined = q.replace(/[\s\-‐-―・･.,'’]+/g, '');
    const base = queryVariants(joined);
    return [...new Set([q, ...bigNameMatches(joined), spaced, ...base, joined])].filter((v) => v.length >= 2).slice(0, 5);
  }
  // 漢字の短い都市名（京都・福岡・東京）は、「市」「都」を付けた形（京都市・福岡市・東京都）でも探す。Open-Meteo は、この形ならすぐ見つかる
  if (/[\u3400-\u9fff]/.test(q) && isCjk(q) && q.length <= 4 && !hasSuffix(q)) return q.length === 2 ? [q, `${q}市`, `${q}都`] : [q, `${q}市`];
  if (!/^[A-Za-z][A-Za-z' -]*$/.test(q)) return [q];
  const big = bigNameMatches(q);
  const lower = q.toLowerCase().replace(/[\s']+/g, '');
  const out = [q];
  const roman = lower.replace(/([aiueo])\1/g, '$1-'); // nyuuyooku → nyu-yo-ku（長音）
  const kana = romajiToKana(roman) ?? romajiToKana(roman.replace(/[bcdfghjklmpqrstvwxyz]+$/, '')); // 打ちかけの子音は除く
  if (kana && kana.length >= 2) out.push(kana);
  const collapsed = lower.replace(/oo|ou/g, 'o').replace(/uu/g, 'u');
  if (collapsed !== lower) out.push(collapsed);
  return [...new Set([...out, ...big])].slice(0, 4);
}

// 「大阪市」「福岡県」のように、市・区・県などの語尾をふくむか（「京都」の「都」は都市名の一部なので、2 文字のときは語尾とみなさない。「東京都」は語尾）
const hasSuffix = (s) => /[市区町村県府郡]$/.test(s) || (s.length >= 3 && /都$/.test(s));
const isCjk = (s) => /^[぀-ヿ㐀-鿿]+$/.test(s);

const round = (n) => Math.round(n * 20) / 20; // 約 5km の格子（同じ都市の重複をまとめる用）
function dedupe(list) {
  const seen = new Set();
  return list.filter((c) => {
    const k = `${c.name}|${round(c.lat)}|${round(c.lng)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function omOne(q, signal, count) {
  const res = await fetch(`${OM}?name=${encodeURIComponent(q)}&count=${count}&language=ja&format=json`, { signal });
  if (!res.ok) throw new Error(`都市の検索に失敗しました（${res.status}）`);
  const data = await res.json();
  return (data.results || [])
    .filter((x) => /^(PPL(?![XHQW])|ADM[123]|ISL)/.test(x.feature_code || ''))
    .map((x) => ({
      id: `om${x.id}`,
      omId: x.id,
      name: x.name,
      sub: [x.admin1 && x.admin1 !== x.name ? x.admin1 : '', x.admin2 && !/^(PPLC|ADM)/.test(x.feature_code || '') && x.admin2 !== x.name ? x.admin2 : ''].filter(Boolean).join('・'),
      code: (x.country_code || '').toUpperCase(),
      lat: x.latitude,
      lng: x.longitude,
      zoom: zoomForOM(x),
      pop: x.population || 0,
      src: 'open-meteo',
    }));
}

/** 入力に合わせた候補（Open-Meteo）。ローマ字は、カタカナなどに直した形でも探して、人口の多い順にまとめる。signal で前の問い合わせをやめられる */
export async function suggestCities(query, { signal, count = 8 } = {}) {
  const q = query.trim();
  if (q.length < 2 && !/[\u3400-\u9fff]/.test(q)) return [];
  const lists = await Promise.all(queryVariants(q).map((v) => omOne(v, signal, count).catch((e) => { if (e.name === 'AbortError') throw e; return []; })));
  const merged = dedupe(lists.flat());
  // 複数の言葉で探したときは、人口の多い順（大きな都市が先）。1 通りだけなら、サービスの並びのまま
  return (lists.filter((l) => l.length).length > 1 || queryVariants(q).length > 1
    ? merged.map((c, i) => ({ c, i })).sort((a, b) => (b.c.pop - a.c.pop) || (a.i - b.i)).map((x) => x.c)
    : merged).slice(0, count);
}

// Nominatim は 1 秒に 1 回まで（利用ポリシー）。続けて呼ばれたら間をあける
let lastOsm = 0;
const osmCache = new Map();
async function osmQuery(q, signal) {
  if (osmCache.has(q)) return osmCache.get(q);
  const wait = lastOsm + 1000 - Date.now(); // 前の問い合わせの開始から 1 秒（利用ポリシー）
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastOsm = Date.now();
  const res = await fetch(`${OSM}?q=${encodeURIComponent(q)}&format=jsonv2&accept-language=ja&limit=10&addressdetails=1&namedetails=1&dedupe=1`, { signal });
  if (!res.ok) throw new Error(`OpenStreetMap の検索に失敗しました（${res.status}）`);
  const data = await res.json();
  osmCache.set(q, data);
  return data;
}

/** 座標から、大まかな地名（市・町と州・県）と国コードを求める（OpenStreetMap の Nominatim。キー不要）。見つからなければ null */
export async function reversePlace(lat, lng, { signal } = {}) {
  const key = `rev|${lat.toFixed(3)}|${lng.toFixed(3)}`;
  let x = osmCache.get(key);
  if (!x) {
    const wait = lastOsm + 1000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastOsm = Date.now();
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&zoom=10&format=jsonv2&accept-language=ja&addressdetails=1&namedetails=1`, { signal });
    if (!res.ok) throw new Error(`地名の取得に失敗しました（${res.status}）`);
    x = await res.json();
    osmCache.set(key, x);
  }
  if (!x || x.error) return null;
  const a = x.address || {};
  const city = a.city || a.town || a.village || a.municipality || a.suburb || a.county || a.state_district || '';
  const name = x.name || city || a.state || a.region || '';
  const admin = a.state || a.province || a.region || '';
  return {
    name,
    en: x.namedetails?.['name:en'] || '',
    local: x.namedetails?.name && x.namedetails.name !== name ? x.namedetails.name : '',
    admin: admin && admin !== name ? admin : '',
    code: (a.country_code || '').toUpperCase(),
  };
}

/** OpenStreetMap で都市・町・県などを探す。駅・道路・店などは除く */
export async function searchCitiesOSM(query, { signal } = {}) {
  const q = query.trim();
  if (!q) return [];
  const queries = queryVariants(q).filter((v) => !/^[\u30a0-\u30ff]+$/.test(v) || v === q).slice(0, 2); // 問い合わせは多くても 2 回（1 秒に 1 回までなので、続けると待たされる）
  const toCities = (rows) => rows
    .filter((x) => (x.category === 'place' && PLACE_OK.test(x.type)) || (x.category === 'boundary' && x.type === 'administrative'))
    .filter((x) => x.category !== 'place' || PLACE_BIG.test(x.type) || Number(x.importance) > 0.3) // 小さな地名（集落・地区）は、重要なものだけ
    .sort((a, b) => Number(b.importance) - Number(a.importance))
    .map((x) => {
      const a = x.address || {};
      const name = x.name || (x.display_name || '').split(',')[0];
      const region = a.state || a.province || a.region || '';
      return {
        id: `osm${x.osm_type}${x.osm_id}`,
        name,
        en: x.namedetails?.['name:en'] || '',
        local: x.namedetails?.name || '', // OpenStreetMap の name は、現地の言語の名前
        sub: region && region !== name ? region : (a.county && a.county !== name ? a.county : ''),
        code: (a.country_code || '').toUpperCase(),
        lat: Number(x.lat),
        lng: Number(x.lon),
        zoom: zoomForOSM(x),
        pop: 0,
        kind: x.category === 'boundary' ? 'admin' : x.type,
        imp: Number(x.importance) || 0,
        src: 'openstreetmap',
      };
    });
  // 「ちゃんとした都市（市・町・行政区で、重要度が高い）」が見つかったら、残りの言い方は試さない
  const good = (c) => /^(admin|city|town|municipality)$/.test(c.kind) && c.imp >= 0.4;
  let rows = [];
  let list = [];
  for (const one of queries) {
    rows = rows.concat(await osmQuery(one, signal));
    list = toCities(rows);
    if (list.some(good)) break;
  }
  return dedupe(list).slice(0, 8);
}

// ---- 英語・現地の言語の名前 ----
// 国の公用語（ISO 639-3）→ Open-Meteo の言語コード（ISO 639-1）
const LANG1 = {
  pol: 'pl', deu: 'de', fra: 'fr', spa: 'es', ita: 'it', por: 'pt', rus: 'ru', ukr: 'uk', bel: 'be', tur: 'tr', ara: 'ar', zho: 'zh', kor: 'ko',
  tha: 'th', vie: 'vi', ind: 'id', msa: 'ms', hin: 'hi', ben: 'bn', urd: 'ur', fas: 'fa', heb: 'he', nld: 'nl', swe: 'sv', nor: 'no', nob: 'nb', dan: 'da',
  fin: 'fi', isl: 'is', ell: 'el', hun: 'hu', ces: 'cs', slk: 'sk', ron: 'ro', bul: 'bg', srp: 'sr', hrv: 'hr', slv: 'sl', bos: 'bs', mkd: 'mk', sqi: 'sq',
  lit: 'lt', lav: 'lv', est: 'et', kat: 'ka', hye: 'hy', aze: 'az', kaz: 'kk', uzb: 'uz', mon: 'mn', nep: 'ne', sin: 'si', khm: 'km', lao: 'lo', mya: 'my',
  amh: 'am', swa: 'sw', afr: 'af', gle: 'ga', cat: 'ca', eus: 'eu', glg: 'gl', mlt: 'mt', tam: 'ta', tel: 'te', kan: 'kn', mal: 'ml', mar: 'mr', guj: 'gu',
  pan: 'pa', tgl: 'tl', fil: 'tl', cym: 'cy', ltz: 'lb', que: 'qu', grn: 'gn', hat: 'ht', jpn: 'ja', eng: 'en',
};
/** その国の現地の言語（Open-Meteo の言語コード）。英語・日本語しかない国や、分からない国は空 */
export function localLangOf(code) {
  for (const l of COUNTRY_INFO[code]?.lang || []) {
    const c = LANG1[l];
    if (c && c !== 'ja' && c !== 'en') return c;
  }
  return '';
}
const nameCache = new Map(); // 'id|言語' → 名前
async function omName(id, lang, signal) {
  const key = `${id}|${lang}`;
  if (nameCache.has(key)) return nameCache.get(key);
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/get?id=${id}&language=${lang}`, { signal });
    if (!res.ok) return '';
    const name = (await res.json()).name || '';
    nameCache.set(key, name);
    return name;
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    return '';
  }
}
/** 英語・現地の言語の名前を取ってきて、c.en・c.local に入れる（Open-Meteo の結果。OpenStreetMap の結果はすでにある）。同じ名前は重ねない */
export async function fillNames(c, { signal } = {}) {
  if (c.filled) return c;
  if (c.omId) {
    const lang = localLangOf(c.code);
    const [en, local] = await Promise.all([omName(c.omId, 'en', signal), lang ? omName(c.omId, lang, signal) : '']);
    c.en = en;
    c.local = local;
  }
  c.filled = true;
  return c;
}
/** 日本語の名前に続けて表示する、英語・現地の言語の名前（同じ綴りは 1 つに、日本語と同じものは省く） */
export function altNames(c) {
  const out = [];
  for (const n of [c.en, c.local]) if (n && n !== c.name && !out.includes(n)) out.push(n);
  return out;
}

/** 入力した言葉に一番合う都市を 1 つ（Enter で決めるとき用）。人口のわかる都市があればそれ、なければ OpenStreetMap で探す */
export async function findCity(query, { signal } = {}) {
  const q = query.trim();
  if (!q) return null;
  let list = [];
  try { list = await suggestCities(q, { signal }); } catch (e) { if (e.name === 'AbortError') throw e; }
  if (list.length && list[0].pop > 0) return list[0];
  const osm = await searchCitiesOSM(q, { signal });
  return osm[0] || list[0] || null;
}
