import { ALIASES } from './aliases.js';

// 地域ごとの国・地域リスト（コード:日本語名:英語名）
// コードは ISO 3166-1 alpha-2（国旗表示に使用）。地域分けは GeoGuessr でよく使われる区分を参考にしています。
const RAW = [
  ['east-asia', '東アジア',
    'JP:日本:Japan|KR:韓国:South Korea|KP:北朝鮮:North Korea|CN:中国:China|TW:台湾:Taiwan|HK:香港:Hong Kong|MO:マカオ:Macau|MN:モンゴル:Mongolia'],
  ['southeast-asia', '東南アジア',
    'TH:タイ:Thailand|VN:ベトナム:Vietnam|LA:ラオス:Laos|KH:カンボジア:Cambodia|MM:ミャンマー:Myanmar|MY:マレーシア:Malaysia|SG:シンガポール:Singapore|ID:インドネシア:Indonesia|PH:フィリピン:Philippines|BN:ブルネイ:Brunei|TL:東ティモール:Timor-Leste'],
  ['south-asia', '南アジア',
    'IN:インド:India|PK:パキスタン:Pakistan|BD:バングラデシュ:Bangladesh|LK:スリランカ:Sri Lanka|NP:ネパール:Nepal|BT:ブータン:Bhutan|MV:モルディブ:Maldives|AF:アフガニスタン:Afghanistan'],
  ['central-asia', '中央アジア',
    'KZ:カザフスタン:Kazakhstan|KG:キルギス:Kyrgyzstan|UZ:ウズベキスタン:Uzbekistan|TJ:タジキスタン:Tajikistan|TM:トルクメニスタン:Turkmenistan'],
  ['middle-east', '中東・コーカサス',
    'TR:トルコ:Turkey|IL:イスラエル:Israel|PS:パレスチナ:Palestine|JO:ヨルダン:Jordan|LB:レバノン:Lebanon|SY:シリア:Syria|IQ:イラク:Iraq|IR:イラン:Iran|SA:サウジアラビア:Saudi Arabia|AE:アラブ首長国連邦:United Arab Emirates|QA:カタール:Qatar|BH:バーレーン:Bahrain|KW:クウェート:Kuwait|OM:オマーン:Oman|YE:イエメン:Yemen|GE:ジョージア:Georgia|AM:アルメニア:Armenia|AZ:アゼルバイジャン:Azerbaijan'],
  ['north-europe', '北ヨーロッパ',
    'IS:アイスランド:Iceland|NO:ノルウェー:Norway|SE:スウェーデン:Sweden|FI:フィンランド:Finland|DK:デンマーク:Denmark|FO:フェロー諸島:Faroe Islands|GL:グリーンランド:Greenland|AX:オーランド諸島:Aland Islands|SJ:スヴァールバル:Svalbard|EE:エストニア:Estonia|LV:ラトビア:Latvia|LT:リトアニア:Lithuania'],
  ['west-europe', '西ヨーロッパ',
    'GB:イギリス:United Kingdom|IE:アイルランド:Ireland|IM:マン島:Isle of Man|JE:ジャージー:Jersey|GG:ガーンジー:Guernsey|FR:フランス:France|BE:ベルギー:Belgium|NL:オランダ:Netherlands|LU:ルクセンブルク:Luxembourg|DE:ドイツ:Germany|AT:オーストリア:Austria|CH:スイス:Switzerland|LI:リヒテンシュタイン:Liechtenstein|MC:モナコ:Monaco'],
  ['south-europe', '南ヨーロッパ',
    'ES:スペイン:Spain|PT:ポルトガル:Portugal|AD:アンドラ:Andorra|GI:ジブラルタル:Gibraltar|IT:イタリア:Italy|SM:サンマリノ:San Marino|VA:バチカン:Vatican City|MT:マルタ:Malta|GR:ギリシャ:Greece|CY:キプロス:Cyprus'],
  ['balkans', 'バルカン半島',
    'SI:スロベニア:Slovenia|HR:クロアチア:Croatia|BA:ボスニア・ヘルツェゴビナ:Bosnia and Herzegovina|RS:セルビア:Serbia|ME:モンテネグロ:Montenegro|XK:コソボ:Kosovo|MK:北マケドニア:North Macedonia|AL:アルバニア:Albania|BG:ブルガリア:Bulgaria'],
  ['east-europe', '東ヨーロッパ',
    'PL:ポーランド:Poland|CZ:チェコ:Czechia|SK:スロバキア:Slovakia|HU:ハンガリー:Hungary|RO:ルーマニア:Romania|MD:モルドバ:Moldova|UA:ウクライナ:Ukraine|BY:ベラルーシ:Belarus|RU:ロシア:Russia'],
  ['north-africa', '北アフリカ',
    'EG:エジプト:Egypt|LY:リビア:Libya|TN:チュニジア:Tunisia|DZ:アルジェリア:Algeria|MA:モロッコ:Morocco|SD:スーダン:Sudan'],
  ['west-central-africa', '西・中部アフリカ',
    'MR:モーリタニア:Mauritania|SN:セネガル:Senegal|GM:ガンビア:Gambia|GW:ギニアビサウ:Guinea-Bissau|GN:ギニア:Guinea|SL:シエラレオネ:Sierra Leone|LR:リベリア:Liberia|CI:コートジボワール:Cote d\'Ivoire|ML:マリ:Mali|BF:ブルキナファソ:Burkina Faso|GH:ガーナ:Ghana|TG:トーゴ:Togo|BJ:ベナン:Benin|NE:ニジェール:Niger|NG:ナイジェリア:Nigeria|CM:カメルーン:Cameroon|TD:チャド:Chad|CF:中央アフリカ:Central African Republic|GQ:赤道ギニア:Equatorial Guinea|GA:ガボン:Gabon|CG:コンゴ共和国:Republic of the Congo|CD:コンゴ民主共和国:DR Congo|CV:カーボベルデ:Cape Verde|ST:サントメ・プリンシペ:Sao Tome and Principe'],
  ['east-south-africa', '東・南部アフリカ',
    'ET:エチオピア:Ethiopia|ER:エリトリア:Eritrea|DJ:ジブチ:Djibouti|SO:ソマリア:Somalia|SS:南スーダン:South Sudan|KE:ケニア:Kenya|UG:ウガンダ:Uganda|RW:ルワンダ:Rwanda|BI:ブルンジ:Burundi|TZ:タンザニア:Tanzania|MZ:モザンビーク:Mozambique|MW:マラウイ:Malawi|ZM:ザンビア:Zambia|ZW:ジンバブエ:Zimbabwe|AO:アンゴラ:Angola|NA:ナミビア:Namibia|BW:ボツワナ:Botswana|ZA:南アフリカ:South Africa|LS:レソト:Lesotho|SZ:エスワティニ:Eswatini|MG:マダガスカル:Madagascar|MU:モーリシャス:Mauritius|RE:レユニオン:Reunion|SC:セーシェル:Seychelles|KM:コモロ:Comoros|YT:マヨット:Mayotte'],
  ['north-america', '北アメリカ',
    'US:アメリカ合衆国:United States|CA:カナダ:Canada|MX:メキシコ:Mexico|BM:バミューダ:Bermuda|PM:サンピエール島・ミクロン島:Saint Pierre and Miquelon'],
  ['central-america', '中米・カリブ',
    'GT:グアテマラ:Guatemala|BZ:ベリーズ:Belize|SV:エルサルバドル:El Salvador|HN:ホンジュラス:Honduras|NI:ニカラグア:Nicaragua|CR:コスタリカ:Costa Rica|PA:パナマ:Panama|CU:キューバ:Cuba|JM:ジャマイカ:Jamaica|HT:ハイチ:Haiti|DO:ドミニカ共和国:Dominican Republic|PR:プエルトリコ:Puerto Rico|BS:バハマ:Bahamas|KY:ケイマン諸島:Cayman Islands|TC:タークス・カイコス諸島:Turks and Caicos|VI:米領ヴァージン諸島:US Virgin Islands|AG:アンティグア・バーブーダ:Antigua and Barbuda|KN:セントクリストファー・ネイビス:Saint Kitts and Nevis|DM:ドミニカ国:Dominica|GP:グアドループ:Guadeloupe|MQ:マルティニーク:Martinique|LC:セントルシア:Saint Lucia|VC:セントビンセント・グレナディーン:Saint Vincent and the Grenadines|GD:グレナダ:Grenada|BB:バルバドス:Barbados|TT:トリニダード・トバゴ:Trinidad and Tobago|AW:アルバ:Aruba|CW:キュラソー:Curacao'],
  ['south-america', '南アメリカ',
    'CO:コロンビア:Colombia|VE:ベネズエラ:Venezuela|GY:ガイアナ:Guyana|SR:スリナム:Suriname|GF:フランス領ギアナ:French Guiana|EC:エクアドル:Ecuador|PE:ペルー:Peru|BO:ボリビア:Bolivia|BR:ブラジル:Brazil|PY:パラグアイ:Paraguay|UY:ウルグアイ:Uruguay|AR:アルゼンチン:Argentina|CL:チリ:Chile|FK:フォークランド諸島:Falkland Islands'],
  ['oceania', 'オセアニア',
    'AU:オーストラリア:Australia|NZ:ニュージーランド:New Zealand|PG:パプアニューギニア:Papua New Guinea|SB:ソロモン諸島:Solomon Islands|VU:バヌアツ:Vanuatu|NC:ニューカレドニア:New Caledonia|FJ:フィジー:Fiji|WS:サモア:Samoa|AS:米領サモア:American Samoa|TO:トンガ:Tonga|PF:フランス領ポリネシア:French Polynesia|CK:クック諸島:Cook Islands|NU:ニウエ:Niue|PN:ピトケアン諸島:Pitcairn Islands|GU:グアム:Guam|MP:北マリアナ諸島:Northern Mariana Islands|PW:パラオ:Palau|FM:ミクロネシア連邦:Micronesia|MH:マーシャル諸島:Marshall Islands|KI:キリバス:Kiribati|NR:ナウル:Nauru|TV:ツバル:Tuvalu|CX:クリスマス島:Christmas Island|CC:ココス諸島:Cocos Islands|NF:ノーフォーク島:Norfolk Island'],
];

// ひらがな入力用: ひらがな → カタカナに変換し、中黒・空白を除いて比較する
export const normKana = (s) => String(s || '').trim()
  .replace(/[\u3041-\u3096]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
  .replace(/[・･\s]/g, '');
export const hasKana = (s) => /[\u3041-\u30ff]/.test(s);

// ---- ローマ字入力用 ----
// ローマ字 → カタカナ（ヘボン式・訓令式の両方と、ファ・ティ・ヴァなどの外来音に対応）
const ROMA = {
  a: 'ア', i: 'イ', u: 'ウ', e: 'エ', o: 'オ',
  ka: 'カ', ki: 'キ', ku: 'ク', ke: 'ケ', ko: 'コ', ca: 'カ', cu: 'ク', co: 'コ',
  sa: 'サ', si: 'シ', shi: 'シ', su: 'ス', se: 'セ', so: 'ソ',
  ta: 'タ', ti: 'チ', chi: 'チ', tu: 'ツ', tsu: 'ツ', te: 'テ', to: 'ト',
  na: 'ナ', ni: 'ニ', nu: 'ヌ', ne: 'ネ', no: 'ノ',
  ha: 'ハ', hi: 'ヒ', hu: 'フ', fu: 'フ', he: 'ヘ', ho: 'ホ',
  ma: 'マ', mi: 'ミ', mu: 'ム', me: 'メ', mo: 'モ',
  ya: 'ヤ', yu: 'ユ', yo: 'ヨ', ye: 'イェ',
  ra: 'ラ', ri: 'リ', ru: 'ル', re: 'レ', ro: 'ロ', la: 'ラ', li: 'リ', lu: 'ル', le: 'レ', lo: 'ロ',
  wa: 'ワ', wi: 'ウィ', we: 'ウェ', wo: 'ヲ',
  ga: 'ガ', gi: 'ギ', gu: 'グ', ge: 'ゲ', go: 'ゴ',
  za: 'ザ', zi: 'ジ', ji: 'ジ', zu: 'ズ', ze: 'ゼ', zo: 'ゾ',
  da: 'ダ', di: 'ディ', du: 'ドゥ', de: 'デ', do: 'ド',
  ba: 'バ', bi: 'ビ', bu: 'ブ', be: 'ベ', bo: 'ボ',
  pa: 'パ', pi: 'ピ', pu: 'プ', pe: 'ペ', po: 'ポ',
  va: 'ヴァ', vi: 'ヴィ', vu: 'ヴ', ve: 'ヴェ', vo: 'ヴォ',
  fa: 'ファ', fi: 'フィ', fe: 'フェ', fo: 'フォ', fyu: 'フュ',
  kya: 'キャ', kyu: 'キュ', kyo: 'キョ', gya: 'ギャ', gyu: 'ギュ', gyo: 'ギョ',
  sha: 'シャ', shu: 'シュ', sho: 'ショ', she: 'シェ', sya: 'シャ', syu: 'シュ', syo: 'ショ',
  cha: 'チャ', chu: 'チュ', cho: 'チョ', che: 'チェ', tya: 'チャ', tyu: 'チュ', tyo: 'チョ', cya: 'チャ', cyu: 'チュ', cyo: 'チョ',
  ja: 'ジャ', ju: 'ジュ', jo: 'ジョ', je: 'ジェ', zya: 'ジャ', zyu: 'ジュ', zyo: 'ジョ', jya: 'ジャ', jyu: 'ジュ', jyo: 'ジョ',
  nya: 'ニャ', nyu: 'ニュ', nyo: 'ニョ', hya: 'ヒャ', hyu: 'ヒュ', hyo: 'ヒョ', mya: 'ミャ', myu: 'ミュ', myo: 'ミョ',
  rya: 'リャ', ryu: 'リュ', ryo: 'リョ', bya: 'ビャ', byu: 'ビュ', byo: 'ビョ', pya: 'ピャ', pyu: 'ピュ', pyo: 'ピョ',
  thi: 'ティ', tei: 'テイ', dhi: 'ディ', dyu: 'デュ', tsa: 'ツァ', tse: 'ツェ', tso: 'ツォ', twu: 'トゥ', qa: 'クァ', kwa: 'クァ', gwa: 'グァ',
};
export function romajiToKana(text) {
  const s = String(text || '').toLowerCase().replace(/[^a-z'-]/g, '');
  let out = '';
  for (let i = 0; i < s.length;) {
    const ch = s[i];
    if (ch === '-') { out += 'ー'; i++; continue; }
    if (ch === "'") { i++; continue; }
    // 促音: 同じ子音の連続（kk, tt, ss, pp…。ただし nn は「ン」）
    if (ch === s[i + 1] && /[bcdfghjklmpqrstvwxyz]/.test(ch) && ch !== 'n') { out += 'ッ'; i++; continue; }
    if (ch === 't' && s[i + 1] === 'c' && s[i + 2] === 'h') { out += 'ッ'; i++; continue; }
    let hit = false;
    for (const len of [3, 2, 1]) {
      const kana = ROMA[s.slice(i, i + len)];
      if (kana) { out += kana; i += len; hit = true; break; }
    }
    if (hit) continue;
    if (ch === 'n') { out += 'ン'; i += s[i + 1] === 'n' ? 2 : 1; continue; } // n の後が母音・y 以外なら「ン」
    if (ch === 'm' && /[bmp]/.test(s[i + 1] || '')) { out += 'ン'; i++; continue; }
    return null; // 末尾の子音だけなど、まだカナにならない入力
  }
  return out;
}
// 表記ゆれを吸収した比較用のカナ: 長音「ー」、同じ段の母音の重ね（オオ・ウウ）、オ段の後の「ウ」を除く
// （chugoku = チュウゴク、porando = ポーランド、oosutoraria = オーストラリア）
const ROWS = {
  ア: 'アカサタナハマヤラワガザダバパャァ', イ: 'イキシチニヒミリギジヂビピィ', ウ: 'ウクスツヌフムユルグズヅブプュゥヴ',
  エ: 'エケセテネヘメレゲゼデベペェ', オ: 'オコソトノホモヨロヲゴゾドボポョォ',
};
const ROW_OF = {};
for (const [v, chars] of Object.entries(ROWS)) for (const ch of chars) ROW_OF[ch] = v;
export const looseKana = (s) => {
  const k = normKana(s).replace(/ー/g, '');
  let out = '';
  for (const ch of k) {
    const prev = ROW_OF[out[out.length - 1]];
    if (ROWS[ch] && prev && (prev === ch || (ch === 'ウ' && prev === 'オ'))) continue; // 伸ばす音を省く
    out += ch;
  }
  return out.replace(/ヴ/g, 'ブ');
};
// ローマ字の入力を比較用カナに（変換できなければ null）。末尾の打ちかけの子音は除いて変換
export function romajiLoose(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!/^[a-z'-]{2,}$/.test(t)) return null;
  const k = romajiToKana(t) ?? romajiToKana(t.replace(/[bcdfghjklmpqrstvwxyz]+$/, ''));
  return k ? looseKana(k) : null;
}

// 漢字を含む国名・地域名の読み（カタカナ。スペース区切りで複数可）
const YOMI = {
  JP: 'ニホン ニッポン', KR: 'カンコク', KP: 'キタチョウセン', CN: 'チュウゴク', TW: 'タイワン', HK: 'ホンコン',
  TL: 'ヒガシティモール', AE: 'アラブシュチョウコクレンポウ', FO: 'フェローショトウ', AX: 'オーランドショトウ', IM: 'マントウ',
  MK: 'キタマケドニア', CF: 'チュウオウアフリカ', GQ: 'セキドウギニア', CG: 'コンゴキョウワコク', CD: 'コンゴミンシュキョウワコク',
  SS: 'ミナミスーダン', ZA: 'ミナミアフリカ', US: 'アメリカガッシュウコク ベイコク', PM: 'サンピエールトウミクロントウ',
  DO: 'ドミニカキョウワコク', KY: 'ケイマンショトウ', TC: 'タークスカイコスショトウ', VI: 'ベイリョウヴァージンショトウ ベイリョウバージンショトウ',
  DM: 'ドミニカコク', GF: 'フランスリョウギアナ', FK: 'フォークランドショトウ', SB: 'ソロモンショトウ', AS: 'ベイリョウサモア',
  PF: 'フランスリョウポリネシア', CK: 'クックショトウ', PN: 'ピトケアンショトウ', MP: 'キタマリアナショトウ', FM: 'ミクロネシアレンポウ',
  MH: 'マーシャルショトウ', CX: 'クリスマストウ', CC: 'ココスショトウ', NF: 'ノーフォークトウ', GB: 'エイコク', AU: 'ゴウシュウ',
};
const REGION_YOMI = {
  'east-asia': 'ヒガシアジア', 'southeast-asia': 'トウナンアジア', 'south-asia': 'ミナミアジア', 'central-asia': 'チュウオウアジア',
  'middle-east': 'チュウトウコーカサス', 'north-europe': 'キタヨーロッパ ホクオウ', 'west-europe': 'ニシヨーロッパ セイオウ',
  'south-europe': 'ミナミヨーロッパ ナンオウ', balkans: 'バルカンハントウ', 'east-europe': 'ヒガシヨーロッパ トウオウ',
  'north-africa': 'キタアフリカ', 'west-central-africa': 'ニシチュウブアフリカ', 'east-south-africa': 'ヒガシナンブアフリカ',
  'north-america': 'キタアメリカ ホクベイ', 'central-america': 'チュウベイカリブ', 'south-america': 'ミナミアメリカ ナンベイ', oceania: 'オセアニア',
};
const kanaKeysOf = (name, yomi) => [normKana(name), ...(yomi ? yomi.split(' ') : [])];
const looseKeysOf = (keys) => [...new Set(keys.map(looseKana))];

export const REGIONS = RAW.map(([id, name, list]) => ({
  id,
  name,
  kana: kanaKeysOf(name, REGION_YOMI[id]),
  get loose() { return (this._loose ||= looseKeysOf(this.kana)); },
  countries: list.split('|').map((s) => {
    const [code, ja, en] = s.split(':');
    const kana = [...kanaKeysOf(ja, YOMI[code]), ...(ALIASES[code] || []).filter((a) => /^[\u30a0-\u30ff・]+$/.test(a)).map(normKana)];
    return { code, ja, en, region: id, aliases: ALIASES[code] || [], kana, loose: looseKeysOf(kana) };
  }),
}));

export const REGION_BY_ID = new Map(REGIONS.map((r) => [r.id, r]));
export const COUNTRIES = REGIONS.flatMap((r) => r.countries);
export const COUNTRY_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export const flagUrl = (code) => `https://flagcdn.com/${code.toLowerCase()}.svg`;

export function regionOf(code) {
  const c = COUNTRY_BY_CODE.get(code);
  return c ? REGION_BY_ID.get(c.region) : null;
}

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\./g, '');
// 完全一致用の索引: 日本語名・英語名・2文字/3文字コード・略称（USA, UK, UAE など）
const EXACT = new Map();
for (const c of COUNTRIES) {
  for (const key of [c.ja, c.en, c.code, ...c.aliases, ...c.kana]) {
    const k = norm(key);
    if (!k) continue;
    if (!EXACT.has(k)) EXACT.set(k, new Set());
    EXACT.get(k).add(c.code);
  }
}

// 国名・略称・コードから国を1つ探す（完全一致）
export function findCountry(text) {
  const hit = EXACT.get(norm(text)) || EXACT.get(norm(normKana(text)));
  if (hit) return COUNTRY_BY_CODE.get([...hit][0]);
  // ローマ字（nihon, porando など）
  const rk = romajiLoose(text);
  return rk ? COUNTRIES.find((c) => c.loose.includes(rk)) || null : null;
}

// 検索語に当てはまる国コードの集合
// 略称・コードに完全一致すればそれだけを返す（「UK」で Ukraine が出ないように）。なければ部分一致
export function searchCountries(text) {
  const q = norm(text);
  if (!q) return new Set();
  const exact = EXACT.get(q);
  if (exact && q.length <= 3 && /^[a-z]+$/.test(q)) return new Set(exact);
  const out = new Set(exact || []);
  const qk = hasKana(q) ? normKana(q) : '';
  const rk = q.length >= 3 ? romajiLoose(q) : null; // ローマ字は3文字以上から（英語の略称と紛れないように）
  for (const c of COUNTRIES) {
    if (qk && c.kana.some((k) => k.includes(qk))) { out.add(c.code); continue; }
    if (rk && c.loose.some((k) => k.includes(rk))) { out.add(c.code); continue; }
    if (c.ja.toLowerCase().includes(q) || c.en.toLowerCase().includes(q) ||
        (q.length >= 3 && c.aliases.some((a) => a.length > 3 && a.toLowerCase().includes(q)))) out.add(c.code);
  }
  return out;
}

// 国選択リストの絞り込み用の文字列
export const searchText = (c) => [c.ja, c.en, c.code, ...c.aliases, ...c.kana].join(' ').toLowerCase();

// 地域名がひらがな・カタカナ・漢字の一部に当てはまるか
export function regionMatches(r, text) {
  const q = String(text || '').trim().toLowerCase();
  if (!q) return false;
  if (r.name.toLowerCase().includes(q)) return true;
  if (hasKana(q)) return r.kana.some((k) => k.includes(normKana(q)));
  const rk = q.length >= 3 ? romajiLoose(q) : null;
  return !!rk && r.loose.some((k) => k.includes(rk));
}
