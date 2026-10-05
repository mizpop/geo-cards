// 浮かぶウィンドウ（ストリートビュー・カードや国の詳細）の重なり順: 最後に触ったものを手前にする
let z = 2400;
export function bringFront(el) {
  if (el) el.style.zIndex = String(++z);
}
