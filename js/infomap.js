// 地図のインフォグラフィック（シェブロン・ガードレール・通行方向・文字・苦手）
// 国ごとの値を色や模様で塗り分けるための定義と、凡例・吹き出し用の表示部品
import { COUNTRY_INFO, LANG_EN } from './countryinfo.js';
import { LANGS, LEFT_DRIVING } from './languages.js';
import { getProg, MAX_BOX } from './progress.js';
import { CHEV_DATA, GUARD_DATA, POLE_DATA, GUARD_TYPES, POLE_TYPES, CHEV_SRC, PLONKIT_SRC, LINE_TYPES, LINE_DATA, LINE_SRC, CAM_DATA, SNOW_DATA, POLE_PHOTO, PLATE_TYPES, PLATE_DATA, PLATE_SRC, BOLLARD_TYPES, BOLLARD_DATA, BOLLARD_SRC } from './infodata.js';

export { GUARD_TYPES, POLE_TYPES, LINE_TYPES, PLATE_TYPES, BOLLARD_TYPES };

export const MAP_MODES = [
  { id: 'cards', icon: '🃏', name: 'カード', desc: '国ごとのカードの枚数とサムネイル' },
  { id: 'none', icon: '🗺', name: 'なし', desc: '何も表示しないただの地図（国の色分け・カード・凡例なし）' },
  { id: 'chevron', icon: '⟫', name: 'シェブロン', desc: 'カーブの矢印標識の色（背景と矢印）', editable: true, pattern: true },
  { id: 'guardrail', icon: '🛡', name: 'ガードレール', desc: 'ガードレールの種類（A / B / 細い B など）と反射板の色', editable: true, pattern: true },
  { id: 'pole', icon: '⚡', name: '電柱', desc: 'よく見る電柱の種類', editable: true, pattern: true },
  { id: 'bollard', icon: '🚧', name: 'ボラード', desc: '道路脇のポール（デリニエーター）の色と帯', editable: true, pattern: true },
  { id: 'plate', icon: '🚘', name: 'ナンバープレート', desc: '自家用車のナンバープレートの色', editable: true, pattern: true },
  { id: 'lines', icon: '🛣', name: '道路の線', desc: '外側の線と中央線の色（白・黄）', editable: true, pattern: true },
  { id: 'drive', icon: '🚗', name: '通行', desc: '左側通行 / 右側通行' },
  { id: 'script', icon: '🔤', name: '文字', desc: '看板で使われる主な文字（ラテン文字以外があればそれ）' },
  { id: 'camera', icon: '📷', name: 'カメラ世代', desc: 'Google カーのカメラの世代（Gen 1〜4）と Low / Small / Bad Cam' },
  { id: 'snow', icon: '❄', name: '雪', desc: '雪景色のカバレッジがある国' },
  { id: 'match', icon: '🔎', name: '条件で絞り込み', desc: 'シェブロン・道路の線・通行などの条件を組み合わせて、当てはまる国を探す' },
  // クイズ専用（地図の表示モードには出さない）: 国の基本データ
  { id: 'tld', icon: '🌐', name: 'ドメイン', desc: '国別のドメイン（.jp など）', quizOnly: true },
  { id: 'phone', icon: '☎', name: '国際電話番号', desc: '国番号（+81 など）', quizOnly: true },
  { id: 'currency', icon: '💴', name: '通貨', desc: '通貨', quizOnly: true },
  { id: 'capital', icon: '🏛', name: '首都', desc: '首都', quizOnly: true },
  { id: 'weak', icon: '🧠', name: '苦手', desc: 'この端末での覚え具合（暗記の「覚えた / まだ」とクイズの結果）' },
];
export const modeDef = (id) => MAP_MODES.find((m) => m.id === id) || MAP_MODES[0];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- シェブロン ---------------- */
export const CHEV_COLORS = [
  { id: 'yellow', name: '黄', hex: '#f6c700' },
  { id: 'black', name: '黒', hex: '#161616' },
  { id: 'white', name: '白', hex: '#ffffff' },
  { id: 'red', name: '赤', hex: '#d7261e' },
  { id: 'blue', name: '青', hex: '#1f5fbf' },
  { id: 'green', name: '緑', hex: '#1e8e4a' },
  { id: 'orange', name: 'オレンジ', hex: '#f08a00' },
];
const chevColor = (id) => CHEV_COLORS.find((c) => c.id === id) || null;
export const chevLabel = (v) => `${chevColor(v.bg)?.name || '?'}地に${chevColor(v.fg)?.name || '?'}の矢印`;
// 標識の見た目（小さな SVG）
export function chevSignSvg(v, w = 36, h = 24) {
  const bg = chevColor(v.bg)?.hex || '#ccc';
  const fg = chevColor(v.fg)?.hex || '#333';
  return `<svg class="chev-sign" viewBox="0 0 36 24" width="${w}" height="${h}" aria-hidden="true"><rect x="0.5" y="0.5" width="35" height="23" rx="2" fill="${bg}" stroke="rgba(0,0,0,.35)"/><path d="M7 5l7 7-7 7M17 5l7 7-7 7M27 5l7 7-7 7" fill="none" stroke="${fg}" stroke-width="3.2" stroke-linejoin="miter"/></svg>`;
}

/* ---------------- ガードレール・電柱（種類を 1〜2 つ） ---------------- */
export const typesOf = (topic) => ({ pole: POLE_TYPES, lines: LINE_TYPES, plate: PLATE_TYPES, bollard: BOLLARD_TYPES }[topic] || GUARD_TYPES);
const typeOf = (topic, id) => typesOf(topic).find((t) => t.id === id) || null;
export const typesLabel = (topic, v) => (v.types || []).map((t) => typeOf(topic, t)?.name || t).join(' ＋ ');

/* ---------------- 初期データ（資料から作成。編集画面で直せます） ---------------- */
const SEED = { chevron: CHEV_DATA, guardrail: GUARD_DATA, pole: POLE_DATA, lines: LINE_DATA, plate: PLATE_DATA, bollard: BOLLARD_DATA };
const SEED_SRC = { chevron: CHEV_SRC, guardrail: PLONKIT_SRC, pole: PLONKIT_SRC, lines: LINE_SRC, plate: PLATE_SRC, bollard: BOLLARD_SRC };

// facts: Map(topic → Map(code → value))。保存した値があればそれ、なければ初期値（seed: true）
let facts = new Map();
export function setFacts(f) { facts = f || new Map(); }
export function factOf(topic, code) {
  const v = facts.get(topic)?.get(code);
  if (v) return v.none ? null : { ...v, seed: false };
  const s = SEED[topic]?.[code];
  if (!s) return null;
  const src = topic === 'pole' && POLE_PHOTO.has(code) ? { name: 'GeoHints（写真）' } : SEED_SRC[topic];
  return { ...s, seed: true, src };
}
export const hasSavedNone = (topic, code) => !!facts.get(topic)?.get(code)?.none;

/* ---------------- 文字 ---------------- */
const SCRIPTS = [
  { id: 'latin', name: 'ラテン文字', color: '#74c0fc', keys: ['ラテン'] },
  { id: 'cyrillic', name: 'キリル文字', color: '#e03131', keys: ['キリル'] },
  { id: 'arabic', name: 'アラビア系文字', color: '#2f9e44', keys: ['アラビア', 'ターナ', 'ナスタアリーク'] },
  { id: 'greek', name: 'ギリシャ文字', color: '#1864ab', keys: ['ギリシャ', 'ギリシア'] },
  { id: 'hebrew', name: 'ヘブライ文字', color: '#7048e8', keys: ['ヘブライ'] },
  { id: 'indic', name: 'インド系文字', color: '#f08c00', keys: ['デーヴァナーガリー', 'ベンガル', 'タミル', 'テルグ', 'カンナダ', 'マラヤーラム', 'グルムキー', 'グジャラート', 'シンハラ', 'チベット'] },
  { id: 'sea', name: '東南アジア系文字', color: '#e64980', keys: ['タイ', 'ラオ', 'クメール', 'ビルマ'] },
  { id: 'cjk', name: '漢字・かな・ハングル', color: '#a61e4d', keys: ['漢字', 'ひらがな', 'ハングル'] },
  { id: 'caucasus', name: 'ジョージア・アルメニア文字', color: '#ae3ec9', keys: ['ジョージア', 'アルメニア'] },
  { id: 'ethiopic', name: 'ゲエズ文字', color: '#d9480f', keys: ['ゲエズ'] },
  { id: 'other', name: 'その他', color: '#868e96', keys: ['ティフィナグ', 'シリア'] },
];
function scriptOfLang(l) {
  const s = LANGS[l]?.s;
  if (!s) return null;
  let best = null;
  let at = Infinity;
  for (const sc of SCRIPTS) {
    for (const k of sc.keys) {
      const i = s.indexOf(k);
      if (i >= 0 && i < at) { at = i; best = sc; }
    }
  }
  return best;
}
// 公用語の並びから決めると違う国（主な言語が後ろにある）
const SCRIPT_OVERRIDE = { IL: 'hebrew' };
function scriptOf(code) {
  if (SCRIPT_OVERRIDE[code]) return SCRIPTS.find((x) => x.id === SCRIPT_OVERRIDE[code]);
  const langs = (COUNTRY_INFO[code]?.lang || []).filter((l) => !/Sign Language/i.test(LANG_EN[l] || ''));
  const found = langs.map(scriptOfLang).filter(Boolean);
  return found.find((s) => s.id !== 'latin') || found[0] || null;
}

/* ---------------- 苦手（この端末の覚え具合） ---------------- */
const WEAK_STEPS = [
  { id: 'w0', name: '苦手（習熟度 0〜1）', color: '#e03131', max: 1 },
  { id: 'w1', name: 'もう少し（〜2.5）', color: '#f59f00', max: 2.5 },
  { id: 'w2', name: 'まあまあ（〜4）', color: '#94d82d', max: 4 },
  { id: 'w3', name: '得意（4 以上）', color: '#2f9e44', max: 99 },
];
let cardsByCountry = new Map();
export function setCards(cards) {
  cardsByCountry = new Map();
  for (const c of cards) for (const code of c.countries) {
    if (!cardsByCountry.has(code)) cardsByCountry.set(code, []);
    cardsByCountry.get(code).push(c);
  }
}
function weakOf(code) {
  const list = cardsByCountry.get(code) || [];
  const ps = list.map((c) => getProg(c.id)).filter(Boolean);
  if (!ps.length) return null;
  const avg = ps.reduce((a, p) => a + p.box, 0) / ps.length;
  const step = WEAK_STEPS.find((s) => avg <= s.max);
  return { step, avg, n: ps.length, total: list.length };
}

/* ---------------- 共通: 国ごとの値 → 分類（凡例の 1 行） ---------------- */
// { key, label, color, swatch(HTML), pattern?: { id, svg } }
// カメラ世代: 一番古い世代で分ける（古い世代があるほど珍しい手がかり）
const CAM_CLASSES = [
  { id: 'g1', test: (f) => f.includes('1'), name: 'Gen 1 あり（最も古い）', color: '#862e9c' },
  { id: 'g2', test: (f) => f.includes('2'), name: 'Gen 2 あり', color: '#e64980' },
  { id: 'g34', test: (f) => f.includes('3') && f.includes('4'), name: 'Gen 3 と Gen 4', color: '#4dabf7' },
  { id: 'g3', test: (f) => f.includes('3'), name: 'Gen 3 のみ', color: '#f59f00' },
  { id: 'g4', test: (f) => f.includes('4'), name: 'Gen 4 のみ', color: '#2f9e44' },
  { id: 'gx', test: () => true, name: 'トレッカーなどのみ', color: '#868e96' },
];
const CAM_NAMES = { 1: 'Gen 1', 2: 'Gen 2', 3: 'Gen 3', 4: 'Gen 4', l: 'Low Cam', s: 'Small Cam', b: 'Bad Cam', t: 'トレッカー' };
const SNOW_CLASSES = { o: { name: '屋外で雪の景色あり', color: '#74c0fc' }, b: { name: '屋外と屋内（スキー場など）', color: '#4dabf7' }, i: { name: '屋内のみ（スキー場など）', color: '#ced4da' } };

// ボラードの小さな絵（本体と帯の色）
function bollardSvg(t) {
  const striped = !!t.stripes;
  return `<svg class="bollard-sign" viewBox="0 0 14 24" width="12" height="22" aria-hidden="true">${t.bg ? `<rect width="14" height="24" rx="3" fill="${t.bg}"/>` : ''}<rect x="2" y="1" width="10" height="22" rx="2" fill="${t.body}" stroke="rgba(0,0,0,.4)"/>${striped
    ? [3, 9, 15].map((y) => `<rect x="2" y="${y}" width="10" height="3" fill="${t.band}"/>`).join('')
    : `<rect x="2" y="3" width="10" height="5" fill="${t.band}"/>`}</svg>`;
}

export function classify(mode, code) {
  if (mode === 'tld' || mode === 'phone' || mode === 'currency' || mode === 'capital') {
    const info = COUNTRY_INFO[code];
    if (!info) return null;
    const v = mode === 'tld' ? info.tld?.[0] : mode === 'phone' ? info.tel : mode === 'currency' ? (info.cur?.[0] ? `${info.cur[0][0]}（${info.cur[0][1]}）` : '') : info.cap?.[0];
    if (!v) return null;
    return { key: v, label: v, color: '#868e96', swatch: '' };
  }
  if (mode === 'camera') {
    const f = CAM_DATA[code];
    if (!f) return null;
    const c = CAM_CLASSES.find((x) => x.test(f));
    return { key: c.id, label: c.name, color: c.color, extra: [...f].map((k) => CAM_NAMES[k]).join('・'), seed: true, src: { name: 'GeoHints' } };
  }
  if (mode === 'snow') {
    const f = SNOW_DATA[code];
    if (!f) return null;
    return { key: f, label: SNOW_CLASSES[f].name, color: SNOW_CLASSES[f].color, seed: true, src: { name: 'GeoHints' } };
  }
  if (mode === 'drive') {
    if (!COUNTRY_INFO[code]) return null;
    return LEFT_DRIVING.has(code)
      ? { key: 'left', label: '⬅ 左側通行', color: '#f76707' }
      : { key: 'right', label: '右側通行 ➡', color: '#4dabf7' };
  }
  if (mode === 'script') {
    const s = scriptOf(code);
    return s ? { key: s.id, label: s.name, color: s.color } : null;
  }
  if (mode === 'weak') {
    const w = weakOf(code);
    return w ? { key: w.step.id, label: w.step.name, color: w.step.color, extra: `習熟度 平均 ${w.avg.toFixed(1)} / ${MAX_BOX}（${w.n} / ${w.total} 枚を学習）` } : null;
  }
  if (mode === 'chevron') {
    const v = factOf('chevron', code);
    if (!v || !chevColor(v.bg) || !chevColor(v.fg)) return null;
    const key = `${v.bg}-${v.fg}`;
    return { key, label: chevLabel(v), pattern: `chev-${key}`, swatch: chevSignSvg(v), seed: v.seed, src: v.src, note: v.note, value: v, alt: (v.alt || []).filter((x) => chevColor(x.bg) && chevColor(x.fg)) };
  }
  if (mode === 'lines') {
    // 外側の線の色と中央線の色の組み合わせ（国によって複数あれば「白と黄」）
    const v = factOf('lines', code);
    const types = (v?.types || []).filter((t) => typeOf('lines', t));
    if (!types.length) return null;
    const edge = [...new Set(types.map((t) => (t[0] === 'y' ? 'Y' : 'W')))].sort().join('');
    const center = [...new Set(types.flatMap((t) => (t === 'wwy' ? ['W', 'Y'] : [t[1] === 'y' ? 'Y' : 'W'])))].sort().join('');
    const key = `${edge}-${center}`;
    const nm = { W: '白', Y: '黄', WY: '白と黄' };
    const LINE_COLORS = { 'W-W': '#dee2e6', 'W-Y': '#fab005', 'W-WY': '#9775fa', 'Y-W': '#4dabf7', 'Y-Y': '#e8590c', 'Y-WY': '#7048e8', 'WY-W': '#1971c2', 'WY-Y': '#c92a2a', 'WY-WY': '#5f3dc4' };
    const color = LINE_COLORS[key] || '#868e96';
    return {
      key, label: `外側 ${nm[edge]}・中央 ${nm[center]}`, color, seed: v.seed, src: v.src, note: v.note, value: v,
      swatch: `<span class="sw sw-line" style="background:${color}"><i style="background:${edge === 'Y' ? '#fcc419' : '#fff'}"></i><i style="background:${center === 'Y' ? '#fcc419' : center === 'WY' ? 'linear-gradient(90deg,#fff 50%,#fcc419 50%)' : '#fff'}"></i></span>`,
      extra: types.length > 1 ? `見られる組み合わせ: ${typesLabel('lines', { types })}` : '',
    };
  }
  if (mode === 'guardrail' || mode === 'pole' || mode === 'plate' || mode === 'bollard') {
    const v = factOf(mode, code);
    let types = (v?.types || []).filter((t) => typeOf(mode, t));
    if (!types.length) return null;
    // 電柱は代表の 1 種類で塗る（2 つ目は吹き出し・右パネルに「ほかに」として出す）
    const others = mode === 'pole' ? types.slice(1) : [];
    if (mode === 'pole') types = types.slice(0, 1);
    const key = [...types].sort().join('+');
    // 縞模様の種類（黒白の縞など）は 1 種類でも模様で塗る
    const t0 = typeOf(mode, types[0]);
    const colors = types.length > 1 ? types.map((t) => typeOf(mode, t).color) : t0.stripes || [t0.color];
    const swatchHtml = mode === 'bollard' ? bollardSvg(t0) : `<span class="sw-multi">${colors.map((c) => `<i style="background:${c}"></i>`).join('')}</span>`;
    return {
      // ボラードは本体と帯のイラストを敷き詰める（シェブロンと同じ）
      key, label: typesLabel(mode, { types }), color: colors[0], pattern: mode === 'bollard' || colors.length > 1 ? `${mode}-${key}` : null, colors, bollard: mode === 'bollard' ? t0 : null,
      swatch: swatchHtml, seed: v.seed, src: v.src, note: v.note, value: v,
      extra: others.length ? `ほかに: ${typesLabel(mode, { types: others })}` : '',
    };
  }
  return null;
}

// 地図の塗り（Leaflet の style）
export function infoStyle(mode, code) {
  const c = code && classify(mode, code);
  if (!c) return { fillColor: '#888', fillOpacity: 0 };
  return { fillColor: c.pattern ? `url(#${c.pattern})` : c.color, fillOpacity: mode === 'weak' ? 0.6 : 0.72 };
}

// 模様（シェブロンの矢印・ガードレール 2 種類の縞）を SVG の defs に用意
export function ensurePatterns(svg, mode, codes) {
  if (!svg) return;
  let defs = svg.querySelector('defs.info-defs');
  if (!defs) {
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.setAttribute('class', 'info-defs');
    svg.prepend(defs);
  }
  const have = new Set([...defs.children].map((p) => p.id));
  let html = '';
  for (const code of codes) {
    const c = classify(mode, code);
    if (!c?.pattern || have.has(c.pattern)) continue;
    have.add(c.pattern);
    if (mode === 'chevron') {
      const bg = chevColor(c.value.bg).hex;
      const fg = chevColor(c.value.fg).hex;
      html += `<pattern id="${c.pattern}" class="info-pat" data-base="" patternUnits="userSpaceOnUse" width="20" height="18"><rect width="20" height="18" fill="${bg}"/><path d="M6 3l6 6-6 6" fill="none" stroke="${fg}" stroke-width="3"/></pattern>`;
    } else if (c.bollard) {
      // 種類ごとの地の色に、ボラードを間隔を空けて斜めに並べる（2 本目は右下にずらす）
      const t = c.bollard;
      const one = (x, y) => `<rect x="${x}" y="${y}" width="6" height="16" rx="1.5" fill="${t.body}" stroke="rgba(0,0,0,.5)" stroke-width=".6"/>${t.stripes
        ? [2, 7, 12].map((dy) => `<rect x="${x}" y="${y + dy}" width="6" height="2.5" fill="${t.band}"/>`).join('')
        : `<rect x="${x}" y="${y + 2}" width="6" height="3.5" fill="${t.band}"/>`}`;
      html += `<pattern id="${c.pattern}" class="info-pat" data-base="" patternUnits="userSpaceOnUse" width="30" height="40"><rect width="30" height="40" fill="${t.bg || '#495057'}"/>${one(5, 2)}${one(20, 22)}</pattern>`;
    } else {
      const [a, b] = c.colors;
      html += `<pattern id="${c.pattern}" class="info-pat" data-base="rotate(45)" patternUnits="userSpaceOnUse" width="14" height="14" patternTransform="rotate(45)"><rect width="7" height="14" fill="${a}"/><rect x="7" width="7" height="14" fill="${b}"/></pattern>`;
    }
  }
  if (html) defs.insertAdjacentHTML('beforeend', html);
}
// 模様の大きさを地図の縮尺に合わせる（拡大するほど大きく）
export function scalePatterns(svg, zoom) {
  const k = Math.min(2.6, Math.max(0.55, 2 ** ((zoom - 4) * 0.5)));
  svg?.querySelectorAll('pattern.info-pat').forEach((pt) => pt.setAttribute('patternTransform', `${pt.dataset.base || ''} scale(${k.toFixed(3)})`.trim()));
}

const swatchOf = (c) => c.swatch || `<span class="sw" style="background:${c.color}"></span>`;

// 凡例: 分類ごとの国の数（codes の中で）
export function legendGroups(mode, codes) {
  const groups = new Map();
  for (const code of codes) {
    const c = classify(mode, code);
    if (!c) continue;
    if (!groups.has(c.key)) groups.set(c.key, { ...c, codes: [] });
    groups.get(c.key).codes.push(code);
  }
  const list = [...groups.values()];
  if (mode === 'weak') list.sort((a, b) => WEAK_STEPS.findIndex((s) => s.id === a.key) - WEAK_STEPS.findIndex((s) => s.id === b.key));
  else if (mode === 'camera') list.sort((a, b) => CAM_CLASSES.findIndex((s) => s.id === a.key) - CAM_CLASSES.findIndex((s) => s.id === b.key));
  else list.sort((a, b) => b.codes.length - a.codes.length);
  return list;
}
export function legendHtml(mode, codes) {
  const groups = legendGroups(mode, codes);
  if (!groups.length) return `<div class="lg-empty">${mode === 'weak' ? 'まだ覚え具合の記録がありません' : 'データがまだありません'}</div>`;
  return groups.map((g) => `<div class="lg-item">${swatchOf(g)}<span>${esc(g.label)}</span><b>${g.codes.length}</b></div>`).join('');
}

// 吹き出し・右パネル用: その国の値
export function factChipHtml(mode, code) {
  const c = classify(mode, code);
  if (!c) return `<span class="fact-chip is-none">${mode === 'weak' ? '未学習' : 'データなし'}</span>`;
  return `<span class="fact-chip">${swatchOf(c)}<span>${esc(c.label)}</span>${c.seed ? `<small class="seed-tag" title="${esc(c.src?.name || '')} の資料から入れた初期データです（編集者が修正できます）">${esc(c.src?.name || '初期値')}</small>` : ''}</span>`;
}
export function factPanelHtml(mode, code) {
  const m = modeDef(mode);
  const c = classify(mode, code);
  return `<div class="pfact-head">${m.icon} ${esc(m.name)}</div>
    <div class="pfact-body">${factChipHtml(mode, code)}</div>
    ${c?.extra ? `<div class="pfact-note pfact-extra">${esc(c.extra)}</div>` : ''}
    ${c?.alt?.length ? `<div class="pfact-alt"><span>ほかに見られる種類</span>${c.alt.map((x) => `<span class="alt-sign" title="${esc(chevLabel(x))}">${chevSignSvg(x)}</span>`).join('')}</div>` : ''}
    ${c?.note ? `<div class="pfact-note">${esc(c.note)}</div>` : ''}`;
}

/* ---------------- 条件で絞り込み（特徴の掛け合わせ） ---------------- */
export const MATCH_TOPICS = ['chevron', 'guardrail', 'pole', 'bollard', 'plate', 'lines', 'drive', 'script', 'camera', 'snow'];
const TYPE_TOPICS = new Set(['guardrail', 'pole', 'bollard', 'plate']);
// 条件の選択肢: 種類のあるもの（ガードレールなど）は種類ごと、それ以外は凡例の分類ごと
export function matchOptions(topic, codes) {
  if (TYPE_TOPICS.has(topic)) {
    const used = new Set();
    for (const c of codes) for (const t of factOf(topic, c)?.types || []) used.add(t);
    return typesOf(topic).filter((t) => used.has(t.id)).map((t) => ({ key: t.id, label: t.name }));
  }
  return legendGroups(topic, codes).map((g) => ({ key: g.key, label: g.label }));
}
// その国が条件に当てはまるか（シェブロンはほかに見られる種類も、種類のあるものは 2 つ目の種類も含める）
export function matches(topic, code, key) {
  if (TYPE_TOPICS.has(topic)) return (factOf(topic, code)?.types || []).includes(key);
  const c = classify(topic, code);
  if (!c) return false;
  if (c.key === key) return true;
  if (topic === 'chevron') return (c.alt || []).some((x) => `${x.bg}-${x.fg}` === key);
  return false;
}
// conds: { topic: key }。すべての条件に当てはまる国
export const matchAll = (conds, codes) => codes.filter((code) => Object.entries(conds).every(([t, k]) => !k || matches(t, code, k)));
