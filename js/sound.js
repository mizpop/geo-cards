// 効果音（音声ファイルは使わず Web Audio でその場で合成する）
// play(name) で鳴らす。ミュート中・音を出せない環境では何もしない

let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;
let lastAt = 0; // 直近に鳴らした時刻（ボタン全般の「タップ音」と重ならないように）

export const setMuted = (m) => { muted = !!m; };
export const isMuted = () => muted;
export const playedRecently = (ms = 80) => performance.now() - lastAt < ms;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    // 白色雑音（めくる・スライドの「シュッ」に使う）
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// 音程のある短い音: 周波数を f0 → f1 に動かし、音量はすぐ立ち上がって減衰
function tone({ f0, f1 = f0, type = 'sine', at = 0, dur = 0.12, vol = 0.2 }) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// 雑音を帯域フィルターに通して「シュッ」という音に
function swish({ f0, f1, at = 0, dur = 0.14, vol = 0.25, q = 1.2 }) {
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = q;
  bp.frequency.setValueAtTime(f0, t);
  bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

const SOUNDS = {
  tap: () => tone({ f0: 1500, f1: 1100, dur: 0.035, vol: 0.07 }), // ボタン全般
  flip: () => swish({ f0: 700, f1: 2600, dur: 0.16, vol: 0.32 }), // カードをめくる
  slide: () => { swish({ f0: 2200, f1: 800, dur: 0.13, vol: 0.18, q: 0.8 }); tone({ f0: 900, dur: 0.03, vol: 0.04, at: 0.02 }); }, // 次 / 前のカード
  tab: () => { swish({ f0: 1200, f1: 3200, dur: 0.1, vol: 0.14, q: 1.5 }); tone({ f0: 660, f1: 990, dur: 0.07, vol: 0.08, at: 0.03 }); }, // タブの切り替え
  open: () => tone({ f0: 420, f1: 820, dur: 0.07, vol: 0.12 }), // 詳細を開く（ポン）
  correct: () => { tone({ f0: 880, dur: 0.12, vol: 0.16, type: 'triangle' }); tone({ f0: 1318.5, dur: 0.22, vol: 0.16, type: 'triangle', at: 0.09 }); },
  partial: () => { tone({ f0: 660, dur: 0.12, vol: 0.14, type: 'triangle' }); tone({ f0: 740, dur: 0.18, vol: 0.12, type: 'triangle', at: 0.1 }); },
  wrong: () => { tone({ f0: 196, f1: 150, dur: 0.26, vol: 0.12, type: 'sawtooth' }); tone({ f0: 185, f1: 140, dur: 0.26, vol: 0.08, type: 'square', at: 0.01 }); },
  finish: () => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone({ f0: f, dur: i === 3 ? 0.45 : 0.14, vol: 0.13, type: 'triangle', at: i * 0.09 })),
};

export function play(name) {
  lastAt = performance.now(); // ミュート中も記録（タップ音の判定を同じにするため）
  if (muted || !SOUNDS[name]) return;
  try {
    if (!audio()) return;
    SOUNDS[name]();
  } catch { /* 音が出せなくても操作は続ける */ }
}
