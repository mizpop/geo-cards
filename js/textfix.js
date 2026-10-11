// 文字化け（UTF-8 の文字を、Latin-1 / Windows-1252 として読んでしまった形。例: Región → RegiÃ³n）を、元に戻す
// 地域の境界データ（geoBoundaries）の地名などに、最初から、こうなっているものがある。直せなければ、そのまま返す
const CP1252 = { 0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x2c6, 0x89: 0x2030, 0x8a: 0x160, 0x8b: 0x2039, 0x8c: 0x152, 0x8e: 0x17d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x2dc, 0x99: 0x2122, 0x9a: 0x161, 0x9b: 0x203a, 0x9c: 0x153, 0x9e: 0x17e, 0x9f: 0x178 };
const BACK = new Map(Object.entries(CP1252).map(([b, u]) => [u, Number(b)]));
const dec = new TextDecoder('utf-8', { fatal: true });
const cache = new Map();
export function fixMojibake(s) {
  if (typeof s !== 'string' || !/[ÂÃÄÅâ][\u0080-¿Œ-™]/.test(s)) return s; // 「Ã³」のような、文字化けの形がなければ、何もしない
  if (cache.has(s)) return cache.get(s);
  let out = s;
  try {
    const bytes = new Uint8Array([...s].map((ch) => {
      const c = ch.codePointAt(0);
      if (c < 0x100) return c;
      if (BACK.has(c)) return BACK.get(c);
      throw new Error('not latin1');
    }));
    const fixed = dec.decode(bytes);
    if (fixed && !fixed.includes('�')) out = fixed;
  } catch { /* 直せない（文字化けではない）ので、そのまま */ }
  cache.set(s, out);
  return out;
}
