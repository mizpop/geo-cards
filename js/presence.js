// Discord Rich Presence に出す内容（Windows 版アプリのみ。electron/discord.js が Discord に送る）。
// 今見ているタブと、クイズのときは何問目かを、2.5 秒ごとに調べて、変わったときだけ送る
const VIEW_LABEL = { study: '暗記カード', quiz: 'クイズ', map: '地図', manage: 'カード', compare: '比較', lang: '言語', sv: 'ストリートビュー' };
let timer = null;
let last = '';

/** 今の状態から、Discord に出す内容を作る（出さないときは null） */
export function presenceOf(state, enabled) {
  if (!enabled || !state.user) return null;
  const view = state.view;
  if (view === 'quiz') {
    const q = state.quiz;
    const n = q.questions?.length || 0;
    const battle = q.kind === 'battle' ? '対戦' : 'クイズ';
    if (q.phase === 'question' && n) return { details: `${battle}に挑戦中`, state: `第 ${Math.min(n, (q.i || 0) + 1)} 問 / ${n}` };
    if (q.phase === 'result') return { details: `${battle}の結果を見ています` };
    return { details: `${battle}を設定中` };
  }
  return { details: `${VIEW_LABEL[view] || 'GeoChecker'}を見ています` };
}

/** deps: { state, settings() } */
export function startPresence(deps) {
  if (!window.desktop?.setPresence || timer) return;
  const tick = () => {
    const p = presenceOf(deps.state, !!deps.settings().discord);
    const json = JSON.stringify(p);
    if (json === last) return;
    last = json;
    window.desktop.setPresence(p);
  };
  tick();
  timer = setInterval(tick, 2500);
}

/** ログアウトなどで、表示を消す */
export function stopPresence() {
  if (timer) { clearInterval(timer); timer = null; }
  if (last !== 'null') { last = 'null'; window.desktop?.setPresence?.(null); }
}
