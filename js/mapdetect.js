// 画像に映り込んだ地図（小さな挿入地図・位置図・カバレッジ図）を、軽量で画像を読めるモデルに探させて、その範囲を消す
// 使うモデル: Gemini 3.5 Flash-Lite → Gemini 3.1 Flash-Lite → Cloudflare AI（Llama 4 Scout）の順（どれも、軽くて、画像を読める）
const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'cloudflare'];
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

async function toSmallJpeg(blob, max = 800) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const data = c.toDataURL('image/jpeg', 0.82).split(',')[1];
  return { data, w: bmp.width, h: bmp.height };
}

async function askVision(api, model, data, prompt) {
  const token = await api.getAccessToken();
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], context: '', model, maxTokens: 1024, image: { media_type: 'image/jpeg', data } }),
  });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message || j.error || `AI に接続できませんでした（${res.status}）`); }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = ''; let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const ev = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = ev.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      let j; try { j = JSON.parse(line.slice(5)); } catch { continue; }
      if (typeof j.text === 'string') text += j.text;
      if (j.error) throw new Error(j.error);
    }
  }
  return text;
}

const PROMPT = `この画像に、地図（地図・位置図・カバレッジ図・地域の区分図・写真の隅に挿入された小さな地図）が映っている範囲を、すべて探してください。
写真そのもの（道路・標識・風景・空など）は含めない。地図の部分だけに、ぴったり合う四角で囲む（地図のふちは含め、周りの余白は含めない）。地図がなければ、空にする。
説明は書かず、次の形の JSON だけで返してください。座標は、画像全体を 1000 とした整数（左上が 0,0）: {"maps":[[上,左,下,右],…]}
地図がないときは {"maps":[]}`;

const REFINE = `この画像には、地図（または地図の一部）が映っています。地図の部分だけにぴったり合う四角を返してください。地図のふちは含め、周りの写真や余白は含めない。地図が画像の端で切れているときは、画像の端までにする。
説明は書かず、次の形の JSON だけで返してください。座標は、画像全体を 1000 とした整数（左上が 0,0）: {"map":[上,左,下,右]}
地図がなければ {"map":null}`;

const parseBoxes = (text, key) => {
  const j = /\{[\s\S]*\}/.exec(text);
  if (!j) throw new Error('範囲を読み取れませんでした');
  const v = JSON.parse(j[0])[key];
  const list = key === 'map' ? (v ? [v] : []) : (v || []);
  // [上, 左, 下, 右]（0〜1000）→ [x, y, 幅, 高さ]（0〜1）
  return list.map((r) => (Array.isArray(r) ? r.map(Number) : [])).filter((r) => r.length === 4 && r.every(Number.isFinite)).map(([t0, l, b0, r0]) => {
    const x0 = clamp(Math.min(l, r0) / 1000); const x1 = clamp(Math.max(l, r0) / 1000); const y0 = clamp(Math.min(t0, b0) / 1000); const y1 = clamp(Math.max(t0, b0) / 1000);
    return [x0, y0, x1 - x0, y1 - y0];
  });
};

async function cropJpeg(blob, [x, y, w, h], max = 1024) {
  const bmp = await createImageBitmap(blob);
  const sx = Math.floor(x * bmp.width); const sy = Math.floor(y * bmp.height);
  const sw = Math.max(1, Math.ceil(w * bmp.width)); const sh = Math.max(1, Math.ceil(h * bmp.height));
  const k = Math.min(2, max / Math.max(sw, sh)); // 小さい範囲は、拡大して、細部を見せる
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
  c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.88).split(',')[1];
}

const overlap = (a, b) => {
  const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  return ix * iy / Math.max(1e-9, Math.min(a[2] * a[3], b[2] * b[3]));
};

/** 画像（Blob）の中の、地図の範囲を探す。戻り値: [[x, y, 幅, 高さ], …]（0〜1 の割合）。
 * 1 回目で大まかな範囲を探し、2 回目で、その周りだけを拡大して、ぴったり合うように絞る。model を省略すると、軽い順に、使えるものを使う */
export async function detectMapRegions(api, blob, { model } = {}) {
  const { data } = await toSmallJpeg(blob, 1280);
  let lastErr = null;
  for (const m of model ? [model] : MODELS) {
    try {
      const rough = parseBoxes(await askVision(api, m, data, PROMPT), 'maps');
      const out = [];
      for (const r of rough) {
        if (r[2] < 0.02 || r[3] < 0.02) continue;
        if (r[2] * r[3] > 0.85) continue; // ほぼ画像全体は、地図ではなく、写真全体を指している可能性が高い
        let box = r;
        try { // 周りに余白をつけて切り出して、もう一度、ぴったり合う範囲を聞く（失敗したら、1 回目の範囲のまま）
          const mx = Math.max(0.03, r[2] * 0.3); const my = Math.max(0.03, r[3] * 0.3);
          const cx0 = clamp(r[0] - mx); const cy0 = clamp(r[1] - my); const cx1 = clamp(r[0] + r[2] + mx); const cy1 = clamp(r[1] + r[3] + my);
          const crop = [cx0, cy0, cx1 - cx0, cy1 - cy0];
          const fine = parseBoxes(await askVision(api, m, await cropJpeg(blob, crop), REFINE), 'map')[0];
          if (fine && fine[2] > 0.1 && fine[3] > 0.1) {
            const cand = [crop[0] + fine[0] * crop[2], crop[1] + fine[1] * crop[3], fine[2] * crop[2], fine[3] * crop[3]];
            const ratio = (cand[2] * cand[3]) / (r[2] * r[3]);
            if (ratio > 0.4 && ratio < 2.5) box = cand; // 1 回目と、かけ離れた答えは、信用しない
          }
        } catch { /* 1 回目の範囲を使う */ }
        // 消し残しが出ないように、ほんの少しだけ広げる
        const px = 0.004;
        const x0 = clamp(box[0] - px); const y0 = clamp(box[1] - px); const x1 = clamp(box[0] + box[2] + px); const y1 = clamp(box[1] + box[3] + px);
        const q = [x0, y0, x1 - x0, y1 - y0];
        if (q[2] * q[3] > 0.85) continue;
        const dup = out.findIndex((o) => overlap(o, q) > 0.7); // ほぼ同じ範囲は、1 つにまとめる
        if (dup >= 0) { const o = out[dup]; const nx0 = Math.min(o[0], q[0]); const ny0 = Math.min(o[1], q[1]); out[dup] = [nx0, ny0, Math.max(o[0] + o[2], q[0] + q[2]) - nx0, Math.max(o[1] + o[3], q[1] + q[3]) - ny0]; } else out.push(q);
      }
      return out;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('地図を探せませんでした');
}

/** 範囲（割合）を、色で塗りつぶした画像（PNG の Blob）を作る */
export async function eraseRegions(blob, regions, color = '#000000') {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0);
  g.fillStyle = color;
  for (const [x, y, w, h] of regions) g.fillRect(Math.floor(x * c.width), Math.floor(y * c.height), Math.ceil(w * c.width), Math.ceil(h * c.height));
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('画像を書き出せませんでした'))), 'image/png'));
}

/** 地図を探して、あれば消した画像を返す: { blob, found }（なければ、元の blob・found = 0） */
export async function removeMaps(api, blob, opts = {}) {
  const regions = await detectMapRegions(api, blob, opts);
  if (!regions.length) return { blob, found: 0 };
  return { blob: await eraseRegions(blob, regions, opts.color), found: regions.length };
}
