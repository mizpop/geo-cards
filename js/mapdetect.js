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
写真そのもの（道路・標識・風景など）は含めない。地図の部分だけを、四角で囲む。地図がなければ、空にする。
説明は書かず、次の形の JSON だけで返してください。座標は、画像の左上を原点、画像全体を 1 とした割合: {"maps":[[x,y,幅,高さ],…]}
地図がないときは {"maps":[]}`;

/** 画像（Blob）の中の、地図の範囲を探す。戻り値: [[x, y, 幅, 高さ], …]（0〜1 の割合）。model を省略すると、軽い順に、使えるものを使う */
export async function detectMapRegions(api, blob, { model } = {}) {
  const { data } = await toSmallJpeg(blob);
  let lastErr = null;
  for (const m of model ? [model] : MODELS) {
    try {
      const text = await askVision(api, m, data, PROMPT);
      const j = /\{[\s\S]*\}/.exec(text);
      if (!j) throw new Error('範囲を読み取れませんでした');
      const arr = (JSON.parse(j[0]).maps || []).map((r) => (Array.isArray(r) ? r.map(Number) : [])).filter((r) => r.length === 4 && r.every(Number.isFinite));
      const out = [];
      for (const [x, y, w, h] of arr) {
        // 少し広めに（地図のふちが残らないように）。ほぼ画像全体の範囲は、地図ではなく、写真全体を指している可能性が高いので、除く
        const px = 0.012; const x0 = clamp(x - px); const y0 = clamp(y - px); const x1 = clamp(x + w + px); const y1 = clamp(y + h + px);
        const ww = x1 - x0; const hh = y1 - y0;
        if (ww < 0.03 || hh < 0.03) continue;
        if (ww * hh > 0.85) continue;
        out.push([x0, y0, ww, hh]);
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
