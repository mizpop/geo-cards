// 検索の「!」コマンド: 解析・セレクター（@all など。& | not とカッコ）・補完・構文のヒント
// 仕様: 引数の種類は text / num / country / card / win / enum（決まった値）。オプションは -名前 または -名前.値（最後に、順不同）
// このファイルは画面に触らない。アプリ側（js/app.js）が env（国・カード・ウィンドウの情報）と actions（実際の操作）を渡す

const normId = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ---- コマンドの定義 ----
// slots: 引数の並び。t: text | num | country | card | win | enum。opt: 省略可。values: enum の値。rest: 以降の引数（...）
export const COMMANDS = {
  help: { desc: 'コマンドの構文や使い方を表示します（コマンド名を付けると、そのコマンドの説明）', slots: [{ t: 'enum', name: 'text', opt: true, values: () => Object.keys(COMMANDS) }] },
  open: { desc: 'GeoChecker のメインウィンドウを開きます（タブを指定できます）', slots: [{ t: 'enum', name: 'text', opt: true, values: ['memorize', 'quiz', 'map', 'cards', 'comparison', 'languages', 'streetviews'] }] },
  exit: { desc: 'GeoChecker を終了します（Windows 版のみ）', slots: [] },
  restart: { desc: 'GeoChecker を再起動します（Windows 版のみ）', slots: [] },
  update: { desc: 'クライアントのアップデートを確認し、実行します（Windows 版のみ）', slots: [] },
  version: { desc: '今の GeoChecker とクライアントのバージョンを表示します', slots: [] },
  win: {
    desc: '外に飛び出たウィンドウ（左下に格納されたものも含む）を操作します（Windows 版のみ）',
    slots: [{ t: 'win', name: 'win' }, { t: 'enum', name: 'text', values: ['open', 'close', 'rename', 'resetname', 'store', 'pin', 'putin'] }],
    subs: { rename: [{ t: 'text', name: 'text' }] },
    values: { open: 'ウィンドウを最前面に出して開く（格納されていれば取り出す）', close: 'ウィンドウを閉じる', rename: 'ウィンドウを改名する（resetname で戻す）', resetname: '改名を元に戻す', store: 'ウィンドウを格納する', pin: 'ウィンドウを最前面に固定する', putin: 'ウィンドウをアプリの中に戻す' },
  },
  card: {
    desc: 'カードを操作します。card create でカードの作成画面、card [card] open / edit',
    slots: [{ t: 'card', name: 'card' }, { t: 'enum', name: 'text', values: ['open', 'edit'] }],
    values: { open: 'カードを開く（-on.[win] でそのウィンドウで、-with.[card] で他のカードも一緒に）', edit: 'カードの編集画面を開く' },
    create: { desc: 'カードを作成するウィンドウを表示します', opts: ['addimage', 'category.[text]', 'country.[country]', 'area.[text]', 'placename.[text]', 'relatedto.[card]', 'textfront.[text]', 'textback.[text]', 'confirm'] },
    opts: { open: ['on.[win]', 'with.[card]'], edit: [] },
  },
  country: {
    desc: '国の情報・Plonkit を開きます',
    slots: [{ t: 'country', name: 'country' }, { t: 'enum', name: 'text', values: ['open', 'plonkit'] }],
    values: { open: '国の情報を開く（-on.[win] でそのウィンドウで）', plonkit: '日本語の Plonkit を開く（-on.[win]・-raw で出典のページをそのまま）' },
    opts: { open: ['on.[win]'], plonkit: ['on.[win]', 'raw'] },
  },
};
export const commandNames = () => Object.keys(COMMANDS);

// ---- 文字列を、引数ごとに分ける（引用符 "…" の中のスペースは文字列の一部。& | not とカッコの前後のスペースは、同じ引数の中） ----
export function scanArgs(s) {
  const segs = [];
  let i = 0;
  const n = s.length;
  let cur = null;
  let depth = 0;
  let inQ = false;
  let joinNext = false; // 直前が & | ( not のとき、スペースのあとも同じ引数
  const push = () => { if (cur) { cur.end = i; segs.push(cur); cur = null; } };
  while (i < n) {
    const ch = s[i];
    if (inQ) { if (ch === '"') inQ = false; i++; continue; }
    if (ch === '"') { if (!cur) cur = { start: i }; inQ = true; i++; continue; }
    if (/\s/.test(ch)) {
      if (cur && depth === 0 && !joinNext) {
        // 次の文字が & | なら、続ける
        let j = i; while (j < n && /\s/.test(s[j])) j++;
        if (j < n && (s[j] === '&' || s[j] === '|')) { i = j; continue; }
        push();
      }
      i++; continue;
    }
    if (!cur) cur = { start: i };
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    joinNext = ch === '&' || ch === '|' || ch === '(' || (/not$/i.test(s.slice(Math.max(0, i - 2), i + 1)) && (i < 3 || /[\s(&|]/.test(s[i - 3] || ' ')));
    i++;
  }
  const open = !!cur;
  if (cur) { cur.end = i; segs.push(cur); }
  for (const g of segs) g.text = s.slice(g.start, g.end);
  return { segs, open, trailingSpace: !open && /\s$/.test(s) };
}

// ---- セレクターの式（& | not とカッコ）----
const SEL = {
  country: { all: null, region: 'text', available: null },
  card: { all: null, available: null, country: 'country', category: 'text', hasstreetview: null, hascard: null, relatedto: 'card' },
  win: { all: null, this: null, country: 'country', plonkit: 'country', streetview: null, card: 'card', minimized: null, maximized: null, stored: null, renamed: null, pinned: null },
};
export const selectorNames = (type) => Object.keys(SEL[type] || {});
const ci = (a, q) => String(a).toLowerCase().includes(String(q).toLowerCase());
const unq = (w) => w.replace(/"/g, '').replace(/\\n/g, '\n');

function tokenizeExpr(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { i++; continue; }
    if ('()&|'.includes(ch)) { out.push({ op: ch }); i++; continue; }
    let j = i; let inQ = false;
    while (j < text.length && (inQ || !/[\s()&|]/.test(text[j]) || (text[j] === ')' && false))) { if (text[j] === '"') inQ = !inQ; j++; }
    // @a.@b.@c のように、. でつながる入れ子は 1 つの語（ここでは、括弧の入れ子はなし）
    out.push({ word: text.slice(i, j) });
    i = j;
  }
  return out;
}

/** 式を解析して、評価用の木にする。失敗したら { error } */
export function parseExpr(text, type) {
  const toks = tokenizeExpr(text);
  let p = 0;
  const parseOr = () => {
    let left = parseAnd();
    while (toks[p]?.op === '|') { p++; const r = parseAnd(); left = { k: 'or', a: left, b: r }; }
    return left;
  };
  const parseAnd = () => {
    let left = parseNot();
    while (toks[p]?.op === '&') { p++; const r = parseNot(); left = { k: 'and', a: left, b: r }; }
    return left;
  };
  const parseNot = () => {
    if (toks[p]?.word?.toLowerCase() === 'not') { p++; return { k: 'not', a: parseNot() }; }
    return parseAtom();
  };
  const parseAtom = () => {
    const t = toks[p];
    if (!t) throw new Error('式が途中で終わっています');
    if (t.op === '(') { p++; const e = parseOr(); if (toks[p]?.op !== ')') throw new Error('カッコが閉じていません'); p++; return e; }
    if (t.op) throw new Error(`「${t.op}」の位置が正しくありません`);
    p++;
    return atomOf(t.word, type);
  };
  try {
    const ast = parseOr();
    if (p < toks.length) throw new Error('式の途中に、余分なものがあります');
    return { ast };
  } catch (e) { return { error: e.message }; }
}
// 語 → 原子（@名前.引数 の入れ子、または、ふつうの語）
function atomOf(word, type) {
  if (!word.startsWith('@')) return { k: 'plain', type, text: unq(word) };
  const m = /^@([A-Za-z]+)(?:\.(.*))?$/s.exec(word);
  if (!m) throw new Error(`セレクター「${word}」が正しくありません`);
  const name = m[1].toLowerCase();
  const def = SEL[type]?.[name];
  if (!(name in (SEL[type] || {}))) throw new Error(`「@${name}」は、この引数では使えません`);
  if (def === null) { if (m[2] != null && m[2] !== '') throw new Error(`「@${name}」には、引数を付けられません`); return { k: 'sel', type, name }; }
  if (m[2] == null || m[2] === '') throw new Error(`「@${name}」は、「@${name}.…」の形で、引数が必要です`);
  return { k: 'sel', type, name, arg: atomOf(m[2], def) };
}

/** 木を評価する。env: { countries, cards, wins } → Set（国: コード / カード: id / ウィンドウ: id） */
export function evalExpr(ast, type, env, wins = []) {
  const all = () => (type === 'country' ? new Set(env.countries.all().map((c) => c.code)) : type === 'card' ? new Set(env.cards.all().map((c) => c.id)) : new Set(wins.map((w) => w.id)));
  const ev = (n, ty = type) => {
    if (n.k === 'and') { const a = ev(n.a, ty); const b = ev(n.b, ty); return new Set([...a].filter((x) => b.has(x))); }
    if (n.k === 'or') return new Set([...ev(n.a, ty), ...ev(n.b, ty)]);
    if (n.k === 'not') { const a = ev(n.a, ty); const all0 = allOf(ty); return new Set([...all0].filter((x) => !a.has(x))); }
    if (n.k === 'plain') return plain(n.text, ty);
    return sel(n, ty);
  };
  const allOf = (ty) => (ty === 'country' ? new Set(env.countries.all().map((c) => c.code)) : ty === 'card' ? new Set(env.cards.all().map((c) => c.id)) : new Set(wins.map((w) => w.id)));
  const plain = (text, ty) => {
    if (ty === 'country') {
      const f = env.countries.find(text);
      if (f) return new Set([f.code]);
      return new Set(env.countries.search(text));
    }
    if (ty === 'card') {
      if (text.startsWith('#')) return new Set(env.cards.all().filter((c) => c.id.startsWith(text.slice(1))).map((c) => c.id));
      return new Set(env.cards.match(text).map((c) => c.id));
    }
    if (ty === 'text') return new Set([text]);
    const q = text.toLowerCase();
    return new Set(wins.filter((w) => (w.title || '').toLowerCase().includes(q)).map((w) => w.id));
  };
  const sel = (n, ty) => {
    const { name } = n;
    if (ty === 'country') {
      if (name === 'all') return allOf('country');
      if (name === 'available') return new Set(env.countries.all().filter((c) => env.countries.playable(c.code)).map((c) => c.code));
      if (name === 'region') { const q = normId(n.arg.text); return new Set(env.countries.all().filter((c) => { const r = env.countries.regionOf(c.code); return normId(r.id) === q || normId(r.en) === q || r.name === n.arg.text; }).map((c) => c.code)); }
    }
    if (ty === 'card') {
      if (name === 'all') return allOf('card');
      if (name === 'available') return new Set(env.cards.all().filter((c) => c.countries.some((x) => env.countries.playable(x))).map((c) => c.id));
      if (name === 'hasstreetview') return new Set(env.cards.all().filter((c) => (c.sv_ids || []).length).map((c) => c.id));
      if (name === 'hascard') return new Set(env.cards.all().filter((c) => (c.related || []).length).map((c) => c.id));
      if (name === 'country') { const cs = ev(n.arg, 'country'); return new Set(env.cards.all().filter((c) => c.countries.some((x) => cs.has(x))).map((c) => c.id)); }
      if (name === 'category') { const q = n.arg.text.toLowerCase(); return new Set(env.cards.all().filter((c) => env.cards.catName(c).toLowerCase().includes(q)).map((c) => c.id)); }
      if (name === 'relatedto') {
        const base = ev(n.arg, 'card');
        const out = new Set();
        for (const c of env.cards.all()) {
          if (base.has(c.id)) continue;
          if ((c.related || []).some((id) => base.has(id)) || [...base].some((id) => (env.cards.byId(id)?.related || []).includes(c.id))) out.add(c.id);
        }
        return out;
      }
    }
    if (ty === 'win') {
      if (name === 'all') return allOf('win');
      if (name === 'this') { const l = wins.filter((w) => w.last); return new Set(l.map((w) => w.id)); }
      const flag = { minimized: 'minimized', maximized: 'maximized', stored: 'stored', renamed: 'renamed', pinned: 'pinned' }[name];
      if (flag) return new Set(wins.filter((w) => w[flag]).map((w) => w.id));
      if (name === 'streetview') return new Set(wins.filter((w) => w.kind === 'sv').map((w) => w.id));
      if (name === 'country') { const cs = ev(n.arg, 'country'); return new Set(wins.filter((w) => w.kind === 'country' && cs.has(w.code)).map((w) => w.id)); }
      if (name === 'plonkit') { const cs = ev(n.arg, 'country'); return new Set(wins.filter((w) => w.kind === 'plonkit' && cs.has(w.code)).map((w) => w.id)); }
      if (name === 'card') { const cs = ev(n.arg, 'card'); return new Set(wins.filter((w) => w.kind === 'card' && cs.has(w.cardId)).map((w) => w.id)); }
    }
    if (ty === 'text') return new Set([n.text || '']);
    return new Set();
  };
  return ev(ast);
}

// ---- 全体の解析: !コマンド 引数… -オプション… ----
const optSplit = (g) => {
  const m = /^-([A-Za-z]+)(?:\.(.*))?$/s.exec(g);
  return m ? { name: m[1].toLowerCase(), raw: m[2] == null ? null : m[2] } : null;
};
/** text は、! から始まる文字列。戻り値: { name, def, sub, args:[{slot, text, ast|error, set}], opts:[{name, value, ...}], errors:[…], segs, open, trailingSpace } */
export function parseCommand(text, env, wins = []) {
  const body = text.replace(/^\s*!/, '');
  const head = /^(\S*)/.exec(body)[1];
  const rest = body.slice(head.length);
  const sc = scanArgs(rest);
  const out = { name: head.toLowerCase(), def: COMMANDS[head.toLowerCase()] || null, args: [], opts: [], errors: [], sub: null, ...sc, head, body };
  if (!out.def) { if (head) out.errors.push(`「${head}」というコマンドはありません（!help で一覧）`); return out; }
  const segs = sc.segs;
  const plain = []; const optSegs = [];
  for (const g of segs) { (optSplit(g.text) ? optSegs : plain).push(g); }
  let slots = out.def.slots;
  // card create
  if (out.name === 'card' && plain[0] && unq(plain[0].text).toLowerCase() === 'create') { out.sub = 'create'; slots = []; plain.shift(); }
  plain.forEach((g, i) => {
    let slot = slots[i];
    if (!slot && out.def.subs && out.args[1]?.text && out.def.subs[out.args[1].text]) slot = out.def.subs[out.args[1].text][i - 2];
    if (!slot) { if (out.def.subs) return; out.errors.push(`余分な引数「${g.text}」があります`); return; }
    const a = { slot, text: g.text, seg: g };
    if (slot.t === 'country' || slot.t === 'card' || slot.t === 'win') {
      const r = parseExpr(g.text, slot.t);
      if (r.error) { a.error = r.error; out.errors.push(r.error); } else { a.ast = r.ast; a.set = evalExpr(r.ast, slot.t, env, wins); }
    } else if (slot.t === 'num') {
      if (!/^-?\d+(\.\d+)?$/.test(g.text)) { a.error = '数値ではありません'; out.errors.push(`「${g.text}」は数値ではありません`); } else a.num = Number(g.text);
    } else if (slot.t === 'enum') {
      const vals = typeof slot.values === 'function' ? slot.values() : slot.values;
      a.value = unq(g.text).toLowerCase();
      if (!vals.includes(a.value)) { a.error = '値が正しくありません'; out.errors.push(`「${g.text}」は使えません（${vals.join(' / ')}）`); }
    } else a.value = unq(g.text);
    out.args.push(a);
  });
  // 必須の引数
  const done = new Set(out.args.map((a) => a.slot));
  const need = (out.sub === 'create' ? [] : slots).filter((s) => !s.opt && !done.has(s));
  out.missing = need;
  // オプション
  for (const g of optSegs) {
    const o = optSplit(g.text);
    out.opts.push({ name: o.name, raw: o.raw, text: g.text, seg: g });
  }
  out.sub = out.sub || out.args[1]?.value || null;
  return out;
}

// ---- 補完 ----
const typeLabel = { text: '[text]', num: '[num]', country: '[country]', card: '[card]', win: '[win]', enum: '[text]' };
function slotLabel(s) { return `${s.opt ? '(' : ''}${s.name ? `[${s.name}]` : typeLabel[s.t]}${s.opt ? ')' : ''}`; }

/** 構文のヒント（薄く、続きに出す文字）: 例: !card [card] [text] */
export function syntaxHint(text, env, wins) {
  const p = parseCommand(text, env, wins);
  if (!p.def) return '';
  const cmdSlots = p.sub === 'create' ? [] : p.def.slots;
  const used = p.args.length + (p.name === 'card' && /^\s*!card\s+create/i.test(text) ? 1 : 0);
  const typed = p.open || p.trailingSpace || /!\S+\s*$/.test(text) && /\s$/.test(text);
  if (!/\s$/.test(text)) return ''; // 単語の途中は、候補の補完に任せる
  const left = [];
  if (p.sub === 'create') left.push('[opt]');
  else {
    const slots = cmdSlots.slice(p.args.length);
    for (const s of slots) left.push(slotLabel(s));
    if (p.def.opts || p.def.create) left.push('[opt]');
  }
  void typed; void used;
  return left.join(' ');
}

/** 候補の一覧: { items: [{ label, insert, desc }], from: 置き換えを始める位置 } */
export function complete(text, env, wins = []) {
  if (!text.startsWith('!')) return { items: [], from: 0 };
  const body = text.slice(1);
  const sp = body.search(/\s/);
  if (sp < 0) { // コマンド名
    const q = body.toLowerCase();
    return { from: 1, items: commandNames().filter((n) => n.startsWith(q)).map((n) => ({ label: `!${n}`, insert: `${n} `, desc: COMMANDS[n].desc })) };
  }
  const p = parseCommand(text, env, wins);
  if (!p.def) return { items: [], from: text.length };
  // 今、入力している語
  const ends = /\s$/.test(text);
  const last = ends ? null : p.segs[p.segs.length - 1];
  const word = last ? last.text : '';
  const wordStart = last ? 1 + p.head.length + last.start : text.length;
  const items = [];
  const add = (label, insert, desc) => items.push({ label, insert, desc });
  // 入れ子の最後の語（@a.@b. の続き）を取り出す
  const lastAtom = (w) => { const m = /(?:^|[\s(&|])((?:@[A-Za-z]*\.?)*[^\s()&|]*)$/.exec(w); return m ? m[1] : w; };
  const atomStart = wordStart + (word.length - lastAtom(word).length);
  const atom = lastAtom(word);

  // どの引数か
  const plain = p.segs.filter((g) => !optSplit(g.text));
  const isOpt = /^-/.test(word) || (last && optSplit(word));
  if (isOpt || (!last && false)) {
    const optList = optionList(p);
    const name = word.replace(/^-/, '');
    const dot = name.indexOf('.');
    if (dot < 0) { for (const o of optList) if (o.toLowerCase().startsWith(name.toLowerCase())) add(`-${o}`, `-${o.replace(/\.\[.*$/, '.')}`, ''); return { items, from: wordStart }; }
    const oname = name.slice(0, dot).toLowerCase();
    const def = optList.find((o) => o.toLowerCase().startsWith(`${oname}.[`));
    const ty = def ? /\[(\w+)\]/.exec(def)[1] : 'text';
    const valStart = wordStart + 1 + dot + 1;
    const d = deepest(ty, name.slice(dot + 1));
    return { items: valueItems(d.ty, d.rest, env, wins), from: valStart + d.off };
  }
  // 位置から、期待する種類
  const idx = ends ? plain.length : Math.max(0, plain.length - 1);
  let slotIdx = idx;
  let slots = p.def.slots;
  if (p.name === 'card' && plain[0] && unq(plain[0].text).toLowerCase() === 'create') return { items: optionList(p).filter((o) => !word || o.toLowerCase().startsWith(word.replace(/^-/, '').toLowerCase())).map((o) => ({ label: `-${o}`, insert: `-${o.replace(/\.\[.*$/, '.')}`, desc: '' })), from: wordStart };
  if (p.name === 'card' && idx === 0) { // card create も候補に
    if (!word || 'create'.startsWith(word.toLowerCase())) add('create', 'create ', 'カードを作成するウィンドウを表示します');
  }
  let slot = slots[slotIdx];
  if (!slot && p.def.subs && plain[1]) { const sub = p.def.subs[unq(plain[1].text)]; slot = sub?.[slotIdx - 2]; }
  if (!slot) { for (const o of optionList(p)) if (!word) add(`-${o}`, `-${o.replace(/\.\[.*$/, '.')}`, ''); return { items, from: wordStart }; }
  const useWord = slot.t === 'enum' || slot.t === 'text' || slot.t === 'num' ? word : atom;
  const useStart = slot.t === 'enum' || slot.t === 'text' || slot.t === 'num' ? wordStart : atomStart;
  if (['country', 'card', 'win'].includes(slot.t)) { const d = deepest(slot.t, useWord); items.push(...valueItems(d.ty, d.rest, env, wins, slot, p)); return { items: dedupe(items), from: useStart + d.off }; }
  items.push(...valueItems(slot.t, useWord, env, wins, slot, p));
  return { items: dedupe(items), from: useStart };
}
const dedupe = (a) => { const seen = new Set(); return a.filter((x) => (seen.has(x.insert) ? false : (seen.add(x.insert), true))); };
function optionList(p) {
  if (p.name === 'card' && p.sub === 'create') return COMMANDS.card.create.opts;
  const sub = p.args[1]?.value || (p.segs[1] ? unq(p.segs[1].text).toLowerCase() : '');
  return (p.def.opts && p.def.opts[sub]) || [];
}
const optSplitLoose = optSplit;
void optSplitLoose;

// @名前.@名前2.… の入れ子の、いちばん内側の種類と、そこから先の文字・位置
function deepest(ty, text) {
  let rest = text; let off = 0; let t = ty;
  for (;;) {
    const m = /^@([A-Za-z]+)\.(.*)$/s.exec(rest);
    const inner = m && SEL[t]?.[m[1].toLowerCase()];
    if (!inner) break;
    off += rest.length - m[2].length; rest = m[2]; t = inner;
  }
  return { ty: t, rest, off };
}
function valueItems(ty, word, env, wins, slot = null, p = null) {
  const items = [];
  const add = (label, insert, desc) => items.push({ label, insert, desc });
  const q = word.replace(/^"/, '');
  if (ty === 'enum') {
    const vals = typeof slot.values === 'function' ? slot.values() : slot.values;
    for (const v of vals) if (v.startsWith(q.toLowerCase())) add(v, `${v} `, (p?.def.values || {})[v] || COMMANDS[v]?.desc || '');
    return items;
  }
  if (ty === 'num') return items;
  if (ty === 'text') {
    if (slot?.name === 'text' && p?.args[1]?.value === 'rename') return items;
    for (const r of env.countries.regions?.() || []) if (!q || normId(r.id).startsWith(normId(q))) add(`${r.en}（${r.name}）`, `${normId(r.id)} `, '');
    return items;
  }
  if (q.startsWith('@')) { // セレクター
    const m = /^@([A-Za-z]*)$/.exec(q);
    if (m) { for (const n of selectorNames(ty)) if (n.startsWith(m[1].toLowerCase())) add(`@${n}`, `@${n}${SEL[ty][n] ? '.' : ' '}`, selDesc(ty, n)); return items; }
    const m2 = /^@([A-Za-z]+)\.(.*)$/s.exec(q);
    if (m2 && SEL[ty][m2[1].toLowerCase()]) { // @名前.引数 → 引数の種類で補完（入れ子）
      const inner = SEL[ty][m2[1].toLowerCase()];
      const sub = valueItems(inner, m2[2], env, wins);
      const base = `@${m2[1]}.`;
      return sub.map((x) => ({ ...x, insert: x.insert, label: x.label, _inner: true, base })).map((x) => ({ ...x, insert: x.insert }));
    }
    return items;
  }
  if (ty === 'country') {
    const t = q.toLowerCase();
    const list = env.countries.all();
    const hits = t ? list.filter((c) => ci(c.ja, t) || ci(c.en, t) || c.code.toLowerCase() === t || env.countries.search(t).has(c.code)).slice(0, 24) : list.slice(0, 24);
    for (const c of hits) add(`${c.ja}（${c.en}）`, `${/\s/.test(c.ja) ? `"${c.ja}"` : c.ja} `, c.code);
    if (!t || '@'.startsWith(t)) add('@…（セレクター）', '@', '@all / @region… / @available');
    return items;
  }
  if (ty === 'card') {
    const t = q.trim();
    const hits = (t ? env.cards.match(t) : env.cards.all()).slice(0, 12);
    for (const c of hits) add(env.cards.label(c), `#${c.id.slice(0, 8)} `, env.cards.catName(c));
    if (!t) add('@…（セレクター）', '@', '@all / @country… / @category… / @hasstreetview / @hascard / @relatedto…');
    return items;
  }
  if (ty === 'win') {
    const t = q.toLowerCase();
    for (const w of wins.filter((x) => !t || (x.title || '').toLowerCase().includes(t)).slice(0, 12)) add(w.title || '(無題)', `${/\s/.test(w.title) || /[()&|]/.test(w.title) ? `"${w.title}"` : w.title} `, w.stored ? '格納中' : '');
    if (!t) add('@…（セレクター）', '@', '@all / @this / @country… / @plonkit… / @streetview / @card… / @minimized …');
    return items;
  }
  return items;
}
const SEL_DESC = {
  country: { all: '全ての国', region: '地域（英語名。例: @region.northamerica）の国全て', available: '出題のある国' },
  card: { all: '全てのカード', available: '出題のあるカード（出題のある国のカード）', country: 'その国のカード', category: 'カテゴリーのカード', hasstreetview: '関連ストリートビューがあるカード', hascard: '関連カードがあるカード', relatedto: 'そのカードに関連したカード全て' },
  win: { all: '全てのウィンドウ', this: '最後に操作したウィンドウ', country: '国の情報のウィンドウ', plonkit: 'Plonkit のウィンドウ', streetview: 'ストリートビューのウィンドウ', card: 'カードのウィンドウ', minimized: '最小化されたウィンドウ', maximized: '最大化されたウィンドウ', stored: '格納されたウィンドウ', renamed: 'win rename で改名したウィンドウ', pinned: '最前面に固定されたウィンドウ' },
};
const selDesc = (ty, n) => SEL_DESC[ty]?.[n] || '';

/** オプションの値を取り出す（-名前.値）: { name: 値のテキスト or true } */
export function optionMap(p) {
  const m = {};
  for (const o of p.opts) m[o.name] = o.raw == null ? true : unq(o.raw);
  return m;
}
export { unq, optSplit };
