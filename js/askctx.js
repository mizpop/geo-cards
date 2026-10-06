// AI アシスタントに渡す「参考資料」を、質問に合わせて組み立てる
// 質問に出てくる国・手がかりの種類（ボラード・シェブロンなど）から、関係するカード・参考写真の解説・
// 国ごとの地図のデータ・言語・学習の記録だけを選んで、文字にまとめる（全部を送ると長くて高くなるため）
// 項目には [C1]（カード）・[P1]（参考写真）の ID を付け、答えの中の ID を押すとその項目を開けるようにする

import { COUNTRIES, COUNTRY_BY_CODE, REGION_BY_ID } from './countries.js';
import { COUNTRY_INFO, LANG_EN } from './countryinfo.js';
import { LANGS, LEFT_DRIVING } from './languages.js';
import { REF_IMAGES, REF_BASE, refInfo, refInfoLoaded } from './refimages.js';
import { factPanelHtml, modeDef } from './infomap.js';
import { getProg, weakness, confusions, activity, streak, dayKey } from './progress.js';

const MAX_CHARS = 10000; // 参考資料全体の最大文字数
const MAX_COUNTRIES = 5;
const MAX_CARDS = 8;
const MAX_PHOTOS = 8;

// 手がかりの種類: 質問に出てくる言葉 → 地図のデータの種類（refimages の種類と同じ id）
const TOPIC_WORDS = [
  ['bollard', /ボラード|bollard/i],
  ['pole', /電柱|電線|ユーティリティ|ポール|pole/i],
  ['chevron', /シェブロン|カーブ.*標識|矢印.*標識|chevron/i],
  ['plate', /ナンバー|プレート|plate/i],
  ['guardrail', /ガードレール|防護柵|guardrail/i],
  ['lines', /道路標示|センターライン|中央線|白線|黄線|ライン/],
  ['drive', /通行|左側|右側|ハンドル/],
  ['camera', /カメラ|Google\s?カー|ジェネレーション|世代|gen\s?[1-4]/i],
  ['snow', /雪|スノー/],
  ['script', /文字|言語|キリル|アラビア|ハングル/],
];
const PHOTO_TOPICS = ['bollard', 'pole', 'chevron', 'plate'];
const STOP = new Set(['教えて', '教え', 'ください', 'です', 'ますか', 'どこ', '特徴', '見分け', 'ポイント', 'について', 'ありますか', 'どれ', 'どんな', 'とは', 'ですか']);

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const htmlToText = (html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('.seed-tag, .pfact-link, a, script, style').forEach((e) => e.remove());
  return clip(doc.body.textContent, 260);
};

// 質問の中の国を探す（長い名前を先に取り、取った部分は他の国の名前の一部として数えない。例: 「パプアニューギニア」の中の「ギニア」）
function findCountries(text) {
  const found = [];
  const taken = [];
  const cands = [];
  for (const c of COUNTRIES) {
    for (const name of [c.ja, c.en, ...(c.aliases || [])]) {
      if (name && String(name).length >= 2) cands.push([String(name), c.code]);
    }
  }
  cands.sort((a, b) => b[0].length - a[0].length);
  const lower = text.toLowerCase();
  for (const [name, code] of cands) {
    const isAscii = /^[\x00-\x7f]+$/.test(name);
    if (isAscii && name.length < 4) continue; // 「JP」「UK」のような短い略称は、ふつうの英単語と区別できないので使わない
    const key = name.toLowerCase();
    let from = 0;
    for (;;) {
      const i = lower.indexOf(key, from);
      if (i < 0) break;
      from = i + key.length;
      if (isAscii && (/[a-z]/.test(lower[i - 1] || '') || /[a-z]/.test(lower[i + key.length] || ''))) continue; // 単語の途中は除く
      if (taken.some(([s, e]) => i < e && i + key.length > s)) continue;
      taken.push([i, i + key.length]);
      if (!found.includes(code)) found.push(code);
    }
  }
  return found;
}

const keywordsOf = (text) => [...new Set((text.match(/[゠-ヿ]{2,}|[一-鿿]{2,}|[A-Za-z0-9]{3,}/g) || []).filter((w) => !STOP.has(w)))];

function countryBlock(code, topics) {
  const c = COUNTRY_BY_CODE.get(code);
  const info = COUNTRY_INFO[code] || {};
  const reg = REGION_BY_ID.get(c.region)?.name || '';
  const langs = (info.lang || []).map((l) => LANGS[l]?.ja || LANG_EN[l] || l).join('・');
  const head = [
    reg && `地域: ${reg}`,
    `通行: ${LEFT_DRIVING.has(code) ? '左側' : '右側'}`,
    info.cap?.length && `首都: ${info.cap.join('・')}`,
    info.tld?.length && `ドメイン: ${info.tld[0]}`,
    info.tel && `電話: ${info.tel}`,
    info.cur?.length && `通貨: ${info.cur.map((x) => x[0]).join('・')}`,
    langs && `言語: ${langs}`,
  ].filter(Boolean).join('／');
  const lines = [`【${c.ja}（${code}）】${head}`];
  const list = topics.length ? topics : ['chevron', 'bollard', 'pole', 'plate', 'guardrail'];
  for (const t of list) {
    if (t === 'drive' || t === 'script') continue; // 通行方向と言語は上の行にある
    let text = '';
    try { text = htmlToText(factPanelHtml(t, code)); } catch { /* 登録なし */ }
    if (text) lines.push(` ・${modeDef(t).name}: ${text}`);
  }
  return lines.join('\n');
}

/**
 * @param {object} o
 * @param {string} o.question 今の質問
 * @param {{role: string, content: string}[]} o.history これまでの会話
 * @param {object} o.deps アプリ側の関数・データ { cards, catOf, cardTopic, countryName, photoNote, langCountries }
 * @param {object|null} o.pinned 開いているカード・写真を指定して聞くとき { type: 'card', id } / { type: 'photo', topic, code, rel }
 * @returns {{ text: string, refs: Map<string, object>, sources: {id: string, label: string}[] }}
 */
export function buildContext({ question, history = [], deps, pinned = null }) {
  const refs = new Map();
  const sources = [];
  const sections = [];

  // ---- 質問に出てくる国と種類（今回の質問になければ、直前の質問から引き継ぐ）
  const prevUser = history.filter((m) => m.role === 'user').slice(-2).map((m) => m.content);
  let countries = findCountries(question);
  // 国が出てこない質問、または短い続きの質問（「チェコと比べると？」など）は、直前の質問の国も引き継ぐ
  if (!countries.length || question.length < 40) for (const c of findCountries(prevUser.join('\n'))) if (!countries.includes(c)) countries.push(c);
  let topics = TOPIC_WORDS.filter(([, re]) => re.test(question)).map(([t]) => t);
  if (!topics.length) topics = TOPIC_WORDS.filter(([, re]) => re.test(prevUser.join('\n'))).map(([t]) => t);
  const pinnedCard = pinned?.type === 'card' ? deps.cards.find((c) => c.id === pinned.id) : null;
  if (pinnedCard) for (const c of pinnedCard.countries) if (!countries.includes(c)) countries.unshift(c);
  if (pinned?.type === 'photo' && !countries.includes(pinned.code)) countries.unshift(pinned.code);
  if (pinned?.type === 'photo' && !topics.includes(pinned.topic)) topics.unshift(pinned.topic);
  countries = countries.slice(0, MAX_COUNTRIES);

  // ---- 国ごとの基本情報と地図のデータ
  if (countries.length) sections.push(['国の情報（地図のデータ）', countries.map((c) => countryBlock(c, topics)).join('\n')]);

  // ---- カード: 国・種類・言葉が合うものを点数で選ぶ
  const kw = keywordsOf(question);
  const scored = deps.cards.map((card) => {
    let s = 0;
    if (card.countries.some((c) => countries.includes(c))) s += 5;
    const t = deps.cardTopic(card);
    if (t && topics.includes(t)) s += 3;
    const text = `${card.description || ''} ${card.notes || ''} ${card.area || ''} ${deps.catOf(card).name}`.toLowerCase();
    for (const w of kw) if (text.includes(w.toLowerCase())) s += 2;
    if (pinnedCard && card.id === pinnedCard.id) s += 100;
    return { card, s };
  }).filter((x) => (countries.length ? x.card.countries.some((c) => countries.includes(c)) || x.s >= 100 : x.s > 0)).sort((a, b) => b.s - a.s).slice(0, MAX_CARDS); // 国が分かっているときは、その国のカードだけ
  const cardLines = [];
  const addCard = (card, extra = '') => {
    if ([...refs.values()].some((r) => r.kind === 'card' && r.id === card.id)) return;
    const id = `C${[...refs.keys()].filter((k) => k.startsWith('C')).length + 1}`;
    refs.set(id, { kind: 'card', id: card.id });
    const label = `${deps.catOf(card).name}・${card.countries.map((c) => deps.countryName(c)).join('・')}`;
    sources.push({ id, label });
    cardLines.push(`[${id}] ${label}${card.area ? `（${clip(card.area, 40)}）` : ''}／説明: ${clip(card.description, 160) || 'なし'}／解説: ${clip(card.notes, 300) || 'なし'}${extra}`);
  };
  for (const { card } of scored) addCard(card);
  if (cardLines.length) sections.push(['ユーザーのカード', cardLines.join('\n')]);

  // ---- 参考写真（GeoHints）: 撮影場所と見分け方の解説、ユーザーの見どころのメモ
  const photoLines = [];
  const photoTopics = (topics.filter((t) => PHOTO_TOPICS.includes(t)).length ? topics.filter((t) => PHOTO_TOPICS.includes(t)) : PHOTO_TOPICS);
  const addPhoto = (topic, code, i) => {
    const rel = REF_IMAGES[topic]?.[code]?.[i];
    if (!rel) return;
    const src = REF_BASE + rel;
    if ([...refs.values()].some((r) => r.kind === 'photo' && r.src === src)) return;
    const info = refInfoLoaded() ? refInfo(topic, rel) : null;
    const id = `P${[...refs.keys()].filter((k) => k.startsWith('P')).length + 1}`;
    refs.set(id, { kind: 'photo', topic, code, i, src });
    const place = /撮影場所: (.+?)付近/.exec(info?.desc || '')?.[1]?.split('・')[0];
    const label = `${modeDef(topic).name}の写真・${deps.countryName(code)}${place ? `（${place}）` : ''}`;
    sources.push({ id, label });
    const note = deps.photoNote(topic, src, code);
    photoLines.push(`[${id}] ${label}／${info?.desc ? clip(info.desc.replace(/\n+/g, '／'), 330) : '解説なし'}${note ? `／ユーザーのメモ: ${clip(note, 120)}` : ''}`);
  };
  if (pinned?.type === 'photo') addPhoto(pinned.topic, pinned.code, REF_IMAGES[pinned.topic]?.[pinned.code]?.indexOf(pinned.rel));
  for (const code of countries) for (const t of photoTopics) {
    const n = REF_IMAGES[t]?.[code]?.length || 0;
    for (let i = 0; i < Math.min(n, 3) && photoLines.length < MAX_PHOTOS; i++) addPhoto(t, code, i);
  }
  if (photoLines.length) sections.push(['参考写真（GeoHints）', photoLines.join('\n')]);

  // ---- 言語・文字
  if (/言語|文字|キリル|アラビア|ハングル|ラテン|ダイアクリティカル|アクセント|語/.test(question) || kw.some((w) => Object.values(LANGS).some((l) => l.ja === w))) {
    const hit = Object.entries(LANGS).filter(([, l]) => question.includes(l.ja)).slice(0, 4).map(([k]) => k);
    for (const c of countries) for (const l of COUNTRY_INFO[c]?.lang || []) if (LANGS[l] && !hit.includes(l) && hit.length < 4) hit.push(l);
    if (hit.length) {
      sections.push(['言語・文字', hit.map((l) => {
        const v = LANGS[l];
        const cs = deps.langCountries(l).slice(0, 12).map((c) => deps.countryName(c)).join('・');
        return `【${v.ja}】文字体系: ${v.s}／特徴的な文字: ${clip(v.c, 80) || 'なし'}／よく見る単語: ${clip(v.w, 90) || 'なし'}／見分けるコツ: ${clip(v.t, 160) || 'なし'}／使われる国: ${cs}`;
      }).join('\n')]);
    }
  }

  // ---- 学習の記録（苦手・復習などを聞かれたとき）
  if (/苦手|弱点|間違|復習|記録|成績|正答|正解率|覚え|学習|勉強|おすすめ/.test(question)) {
    const act = activity();
    const lines = [];
    const today = act.days?.[dayKey()];
    lines.push(`今日: ${today ? `${today.n} 問（正解 ${today.ok}）` : 'まだ学習なし'}／連続学習: ${streak()} 日`);
    const regs = Object.entries(act.regions || {}).filter(([, r]) => r.n >= 3).map(([id, r]) => `${REGION_BY_ID.get(id)?.name || id} ${Math.round((r.ok / r.n) * 100)}%（${r.n} 問）`);
    if (regs.length) lines.push(`地域ごとの正答率: ${regs.join('、')}`);
    const conf = confusions().slice(0, 8).map(({ pair, n }) => `${pair.map((c) => deps.countryName(c)).join('と')}（${n} 回）`);
    if (conf.length) lines.push(`よく間違える組み合わせ: ${conf.join('、')}`);
    const weak = deps.cards.filter((c) => getProg(c.id)).sort((a, b) => weakness(b.id) - weakness(a.id)).slice(0, 6);
    sections.push(['学習の記録', lines.join('\n')]);
    if (weak.length) {
      const before = cardLines.length;
      for (const card of weak) { const p = getProg(card.id); addCard(card, `／習熟度 ${p.box}/5（覚えた ${p.ok} 回・まだ ${p.ng} 回）`); }
      if (cardLines.length > before) sections.push(['苦手なカード（習熟度の低い順）', cardLines.slice(before).join('\n')]);
    }
  }

  // ---- 何も当てはまらなかったとき: アプリの中身の概要
  if (!sections.length) {
    const byCat = new Map();
    for (const c of deps.cards) byCat.set(deps.catOf(c).name, (byCat.get(deps.catOf(c).name) || 0) + 1);
    sections.push(['アプリの内容の概要', `カード ${deps.cards.length} 枚（${[...byCat].map(([k, v]) => `${k} ${v}`).join('、')}）／参考写真 ${Object.values(REF_IMAGES).reduce((a, m) => a + Object.values(m).reduce((x, l) => x + l.length, 0), 0)} 枚（ボラード・電柱・シェブロン・ナンバープレート）／地図のデータ: シェブロン・ガードレール・電柱・ボラード・ナンバープレート・道路標示・通行方向・文字・Google カーの世代・雪`]);
  }

  // ---- まとめる（長すぎるときは後ろの章から削る）
  let text = '';
  for (const [title, body] of sections) {
    const part = `## ${title}\n${body}\n\n`;
    if (text.length + part.length > MAX_CHARS) { text += `## ${title}\n${body.slice(0, Math.max(0, MAX_CHARS - text.length - title.length - 20))}…\n`; break; }
    text += part;
  }
  // 本文に残らなかった項目の ID は、出典の一覧からも外す
  const kept = new Set([...text.matchAll(/\[([CP]\d+)\]/g)].map((m) => m[1]));
  for (const id of [...refs.keys()]) if (!kept.has(id)) refs.delete(id);
  return { text: text.trim(), refs, sources: sources.filter((s) => kept.has(s.id)) };
}
