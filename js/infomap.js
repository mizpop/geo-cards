// 地図のインフォグラフィック（シェブロン・ガードレール・通行方向・文字・苦手）
// 国ごとの値を色や模様で塗り分けるための定義と、凡例・吹き出し用の表示部品
import { COUNTRY_INFO, LANG_EN } from './countryinfo.js';
import { LANGS, LEFT_DRIVING } from './languages.js';
import { getProg, MAX_BOX } from './progress.js';
import { CHEV_DATA, GUARD_DATA, POLE_DATA, GUARD_TYPES, POLE_TYPES, CHEV_SRC, PLONKIT_SRC } from './infodata.js';

export { GUARD_TYPES, POLE_TYPES };

export const MAP_MODES = [
  { id: 'cards', icon: '🃏', name: 'カード', desc: '国ごとのカードの枚数とサムネイル' },
  { id: 'chevron', icon: '⟫', name: 'シェブロン', desc: 'カーブの矢印標識の色（背景と矢印）', editable: true, pattern: true },
  { id: 'guardrail', icon: '🛡', name: 'ガードレール', desc: 'ガードレールの種類（A / B / 細い B など）と反射板の色', editable: true, pattern: true },
  { id: 'pole', icon: '⚡', name: '電柱', desc: 'よく見る電柱の種類', editable: true, pattern: true },
  { id: 'drive', icon: '🚗', name: '通行', desc: '左側通行 / 右側通行' },
  { id: 'script', icon: '🔤', name: '文字', desc: '看板で使われる主な文字（ラテン文字以外があればそれ）' },
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
export const typesOf = (topic) => (topic === 'pole' ? POLE_TYPES : GUARD_TYPES);
const typeOf = (topic, id) => typesOf(topic).find((t) => t.id === id) || null;
export const typesLabel = (topic, v) => (v.types || []).map((t) => typeOf(topic, t)?.name || t).join(' ＋ ');

/* ---------------- 初期データ（資料から作成。編集画面で直せます） ---------------- */
const SEED = { chevron: CHEV_DATA, guardrail: GUARD_DATA, pole: POLE_DATA };
const SEED_SRC = { chevron: CHEV_SRC, guardrail: PLONKIT_SRC, pole: PLONKIT_SRC };

// facts: Map(topic → Map(code → value))。保存した値があればそれ、なければ初期値（seed: true）
let facts = new Map();
export function setFacts(f) { facts = f || new Map(); }
export function factOf(topic, code) {
  const v = facts.get(topic)?.get(code);
  if (v) return v.none ? null : { ...v, seed: false };
  const s = SEED[topic]?.[code];
  return s ? { ...s, seed: true, src: SEED_SRC[topic] } : null;
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
export function classify(mode, code) {
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
  if (mode === 'guardrail' || mode === 'pole') {
    const v = factOf(mode, code);
    let types = (v?.types || []).filter((t) => typeOf(mode, t));
    if (!types.length) return null;
    // 電柱は代表の 1 種類で塗る（2 つ目は吹き出し・右パネルに「ほかに」として出す）
    const others = mode === 'pole' ? types.slice(1) : [];
    if (mode === 'pole') types = types.slice(0, 1);
    const key = [...types].sort().join('+');
    const colors = types.map((t) => typeOf(mode, t).color);
    return {
      key, label: typesLabel(mode, { types }), color: colors[0], pattern: types.length > 1 ? `${mode}-${key}` : null, colors,
      swatch: `<span class="sw-multi">${colors.map((c) => `<i style="background:${c}"></i>`).join('')}</span>`, seed: v.seed, src: v.src, note: v.note, value: v,
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
    ${c?.extra ? `<div class="pfact-note">${esc(c.extra)}</div>` : ''}
    ${c?.alt?.length ? `<div class="pfact-alt"><span>ほかに見られる種類</span>${c.alt.map((x) => `<span class="alt-sign" title="${esc(chevLabel(x))}">${chevSignSvg(x)}</span>`).join('')}</div>` : ''}
    ${c?.note ? `<div class="pfact-note">${esc(c.note)}</div>` : ''}`;
}
