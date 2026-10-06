// 世界の都市の検索（地図の検索バー用。キー不要の無料の 2 つのサービスを使う）
//  1. Open-Meteo のジオコーディング: 入力に合わせた候補（日本語の名前・人口つき）。「パリ」「ワルシャワ」「Tokyo」などは見つかるが、
//     「東京」「大阪」「京都」のような漢字だけの名前は見つからないことがある
//  2. OpenStreetMap の Nominatim: Enter や「もっと探す」を押したときだけ問い合わせる（入力のたびには送らない・1 秒に 1 回まで）
//     漢字だけの名前は、「市」を付けた名前（京都 → 京都市）でも探す
// 戻り値の都市: { id, name, sub（県・国など）, code（国コード・大文字）, lat, lng, zoom, pop, src }

import { romajiToKana } from './countries.js';

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
export function queryVariants(query) {
  const q = query.trim();
  if (!/^[A-Za-z][A-Za-z' -]*$/.test(q)) return [q];
  const lower = q.toLowerCase().replace(/[\s']+/g, '');
  const out = [q];
  const roman = lower.replace(/([aiueo])\1/g, '$1-'); // nyuuyooku → nyu-yo-ku（長音）
  const kana = romajiToKana(roman) ?? romajiToKana(roman.replace(/[bcdfghjklmpqrstvwxyz]+$/, '')); // 打ちかけの子音は除く
  if (kana && kana.length >= 2) out.push(kana);
  const collapsed = lower.replace(/oo|ou/g, 'o').replace(/uu/g, 'u');
  if (collapsed !== lower) out.push(collapsed);
  return [...new Set(out)].slice(0, 3);
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
  const wait = lastOsm + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastOsm = Date.now();
  const res = await fetch(`${OSM}?q=${encodeURIComponent(q)}&format=jsonv2&accept-language=ja&limit=10&addressdetails=1&dedupe=1`, { signal });
  if (!res.ok) throw new Error(`OpenStreetMap の検索に失敗しました（${res.status}）`);
  const data = await res.json();
  osmCache.set(q, data);
  return data;
}

/** OpenStreetMap で都市・町・県などを探す。駅・道路・店などは除く */
export async function searchCitiesOSM(query, { signal } = {}) {
  const q = query.trim();
  if (!q) return [];
  const queries = queryVariants(q);
  if (isCjk(q) && !hasSuffix(q) && q.length <= 4) queries.push(`${q}市`); // 京都 → 京都市（駅や集落より先に市が出るように）
  const rows = [];
  for (const one of queries) rows.push(...(await osmQuery(one, signal)));
  const list = rows
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
        sub: region && region !== name ? region : (a.county && a.county !== name ? a.county : ''),
        code: (a.country_code || '').toUpperCase(),
        lat: Number(x.lat),
        lng: Number(x.lon),
        zoom: zoomForOSM(x),
        pop: 0,
        src: 'openstreetmap',
      };
    });
  return dedupe(list).slice(0, 8);
}
