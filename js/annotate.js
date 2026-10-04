// 画像への書き込み（丸・矢印・四角・ペン）。完成した画像を Blob で返す（キャンセルなら null）
const COLORS = [['#ff3b30', '赤'], ['#ffd60a', '黄'], ['#ffffff', '白'], ['#0a84ff', '青'], ['#000000', '黒']];
const TOOLS = [['ellipse', '◯ 丸'], ['arrow', '➜ 矢印'], ['rect', '▢ 四角'], ['pen', '✎ ペン']];

export function annotateImage(src, host = document.body) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => start(img);
    img.onerror = () => resolve(null);
    img.src = src;

    function start(image) {
      const W = image.naturalWidth;
      const H = image.naturalHeight;
      const lw = Math.max(3, Math.round(Math.max(W, H) / 220)); // 線の太さは画像の大きさに合わせる
      const shapes = [];
      let tool = 'ellipse';
      let color = COLORS[0][0];
      let draft = null;

      const box = document.createElement('div');
      box.className = 'annot';
      box.innerHTML = `
        <div class="annot-bar">
          <div class="seg annot-tools">${TOOLS.map(([id, label]) => `<button type="button" data-tool="${id}" class="${id === tool ? 'on' : ''}">${label}</button>`).join('')}</div>
          <div class="annot-colors">${COLORS.map(([c, n]) => `<button type="button" class="annot-color ${c === color ? 'on' : ''}" data-color="${c}" style="--c:${c}" title="${n}" aria-label="${n}"></button>`).join('')}</div>
          <button type="button" class="btn btn-sm" data-act="undo" title="ひとつ戻す（Ctrl+Z）">↶ 戻す</button>
          <button type="button" class="btn btn-sm btn-ghost" data-act="clear">すべて消す</button>
          <span class="grow"></span>
          <button type="button" class="btn btn-sm btn-ghost" data-act="cancel">キャンセル</button>
          <button type="button" class="btn btn-sm btn-primary" data-act="done">完了</button>
        </div>
        <div class="annot-stage"><canvas></canvas></div>
        <p class="annot-hint">ドラッグして描きます。注目してほしいところに丸や矢印をつけましょう</p>`;
      host.appendChild(box);
      const canvas = box.querySelector('canvas');
      canvas.width = W;
      canvas.height = H;
      const g = canvas.getContext('2d');

      const drawShape = (s) => {
        g.strokeStyle = s.color;
        g.fillStyle = s.color;
        g.lineWidth = lw;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        // 暗い背景でも見えるように、細い影をつける
        g.shadowColor = s.color === '#000000' ? 'rgba(255,255,255,.7)' : 'rgba(0,0,0,.6)';
        g.shadowBlur = lw;
        if (s.type === 'pen') {
          g.beginPath();
          s.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
          g.stroke();
        } else if (s.type === 'rect') {
          g.strokeRect(Math.min(s.x0, s.x1), Math.min(s.y0, s.y1), Math.abs(s.x1 - s.x0), Math.abs(s.y1 - s.y0));
        } else if (s.type === 'ellipse') {
          g.beginPath();
          g.ellipse((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, Math.max(1, Math.abs(s.x1 - s.x0) / 2), Math.max(1, Math.abs(s.y1 - s.y0) / 2), 0, 0, Math.PI * 2);
          g.stroke();
        } else if (s.type === 'arrow') {
          const a = Math.atan2(s.y1 - s.y0, s.x1 - s.x0);
          const head = lw * 4.5;
          g.beginPath();
          g.moveTo(s.x0, s.y0);
          g.lineTo(s.x1 - Math.cos(a) * head * 0.6, s.y1 - Math.sin(a) * head * 0.6);
          g.stroke();
          g.beginPath();
          g.moveTo(s.x1, s.y1);
          g.lineTo(s.x1 - head * Math.cos(a - 0.45), s.y1 - head * Math.sin(a - 0.45));
          g.lineTo(s.x1 - head * Math.cos(a + 0.45), s.y1 - head * Math.sin(a + 0.45));
          g.closePath();
          g.fill();
        }
        g.shadowBlur = 0;
      };
      const redraw = () => {
        g.clearRect(0, 0, W, H);
        g.drawImage(image, 0, 0);
        for (const s of shapes) drawShape(s);
        if (draft) drawShape(draft);
      };
      redraw();

      const pos = (e) => {
        const r = canvas.getBoundingClientRect();
        return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
      };
      canvas.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        const [x, y] = pos(e);
        draft = tool === 'pen' ? { type: 'pen', color, pts: [[x, y]] } : { type: tool, color, x0: x, y0: y, x1: x, y1: y };
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!draft) return;
        const [x, y] = pos(e);
        if (draft.type === 'pen') draft.pts.push([x, y]); else { draft.x1 = x; draft.y1 = y; }
        redraw();
      });
      const finish = () => {
        if (!draft) return;
        const big = draft.type === 'pen' ? draft.pts.length > 1 : Math.hypot(draft.x1 - draft.x0, draft.y1 - draft.y0) > lw * 2;
        if (big) shapes.push(draft);
        draft = null;
        redraw();
      };
      canvas.addEventListener('pointerup', finish);
      canvas.addEventListener('pointercancel', finish);

      const close = (result) => {
        document.removeEventListener('keydown', onKey, true);
        box.remove();
        resolve(result);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); e.stopPropagation(); shapes.pop(); redraw(); }
      };
      document.addEventListener('keydown', onKey, true);
      box.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
        tool = b.dataset.tool;
        box.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x === b));
      }));
      box.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => {
        color = b.dataset.color;
        box.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
      }));
      box.querySelector('[data-act="undo"]').addEventListener('click', () => { shapes.pop(); redraw(); });
      box.querySelector('[data-act="clear"]').addEventListener('click', () => { shapes.length = 0; redraw(); });
      box.querySelector('[data-act="cancel"]').addEventListener('click', () => close(null));
      box.querySelector('[data-act="done"]').addEventListener('click', () => {
        if (!shapes.length) { close(null); return; }
        canvas.toBlob((b) => close(b), 'image/png');
      });
    }
  });
}
