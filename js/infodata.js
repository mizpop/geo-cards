// 地図のインフォグラフィックの初期データ（2026-10 時点の資料から作成。編集者が画面から修正・追加できます）
//
// シェブロン: GeoHints（https://geohints.com/meta/signs/chevrons）の国ごとの標識画像の色を読み取ったもの。
//   「背景色 + 矢印の色」を 1 文字ずつで表す（Y 黄 / K 黒 / W 白 / R 赤 / B 青 / G 緑 / O オレンジ）。
//   最初が地図で塗る代表（いちばん多い組み合わせ）、2 つ目以降はほかに見られる種類。
//   背景と矢印の取り違えやすい国は Plonkit の各国ガイドの記述で確認・修正（エストニア・スペイン・オーストリアなど）。
// ガードレール: Plonkit のヨーロッパのガードレール図（europeguardrail.png）と各国ガイドの記述から。
// 電柱: Plonkit の各国ガイドの記述から、よく見る種類を 1〜2 つ。

export const CHEV_SRC = { name: 'GeoHints', url: 'https://geohints.com/meta/signs/chevrons' };
export const PLONKIT_SRC = { name: 'Plonkit', url: 'https://www.plonkit.net/guide' };

const CHEV_RAW = `
BW:WR,YK SZ:WR GH:YK KE:YK LS:WR,YK NA:WR NG:KY,YR,WR RW:WR RE:BW SN:WB,WR ZA:WR,YK TN:BW UG:WK,YK,KW
BD:WK KH:KY CX:KW HK:KW IN:OK,YK ID:OK IL:KW,WK JP:OK,YK,KY,WR,YR JO:WR KZ:YK,WR KG:WR LA:YK LB:BW,WR
MO:YK MY:OK,YK MN:RW NP:KW OM:OK,YK PH:WR,WK,OK QA:RW,BW,KY,YR RU:RW SG:OK KR:OK,YK,WR LK:WR TW:OK TH:OK
AE:WR,YR,WK VN:YK,RW
AL:KW,WR AD:WB AT:RW,YR,WR BE:WR BA:WR BG:WR HR:WR,YR CY:WR CZ:WR,YR DK:WR EE:RW FO:WR FI:KY FR:BW,WR
GE:RW DE:WR GI:OK GR:KW HU:RW,WR IS:KY IE:KY IM:KW IT:KW,RW JE:KW XK:WR,WK LV:WR LI:WK LT:WR LU:KY,WR,BY
MT:KW MC:WR ME:YR,WK NL:WR MK:WR NO:KY PL:WR PT:KY RO:WR SM:YR RS:WK SK:WR SI:WR,WK ES:KW,BW SE:BY,RO
CH:KW,WK TR:WR,KY UA:RW GB:KW BM:KW
CA:YK,KY,WK,RW CR:OK CW:WR DO:OK GL:WR GT:YK MX:OK PA:WB,YK PR:OK US:YK,WK VI:OK
AS:YK AU:YK,KW,OK,WG,WK,GW,BY GU:YK NZ:YK,KW,WK
AR:WR,WB BO:OK BR:KY CL:YK CO:OK,YK EC:YK PE:YK,OK UY:OK
`;
const C = { Y: 'yellow', K: 'black', W: 'white', R: 'red', B: 'blue', G: 'green', O: 'orange' };
export const CHEV_DATA = {};
for (const item of CHEV_RAW.trim().split(/\s+/)) {
  const [code, list] = item.split(':');
  const [first, ...rest] = list.split(',').map((p) => ({ bg: C[p[0]], fg: C[p[1]] }));
  CHEV_DATA[code] = { ...first, ...(rest.length ? { alt: rest } : {}) };
}

// ---- ガードレール
// B プロファイルは 2 種類: 普通の B（四角い段が 2 つ）と、チェコ・スロバキアの「細い B」（幅が狭く中央が高い）
export const GUARD_TYPES = [
  { id: 'a', name: 'A プロファイル（丸い波形）', short: 'A', color: '#d6334a' },
  { id: 'b', name: 'B プロファイル（四角い 2 段）', short: 'B', color: '#4263eb' },
  { id: 'b-thin', name: 'B プロファイル・細型（チェコ・スロバキア）', short: '細い B', color: '#f0c419' },
  { id: 'a-white', name: '白く塗った波形（日本など）', short: '白', color: '#f1f3f5' },
  { id: 'box', name: '角パイプ（ボックスビーム）', short: '角', color: '#f76707' },
  { id: 'cable', name: 'ワイヤーロープ', short: 'ワイヤー', color: '#e64980' },
  { id: 'concrete', name: 'コンクリート', short: 'コンクリ', color: '#a9825a' },
  { id: 'none', name: 'ほとんど見ない', short: 'なし', color: '#343a40' },
];
const g = (types, note) => ({ types, ...(note ? { note } : {}) });
export const GUARD_DATA = {
  // ヨーロッパ（Plonkit の図）
  IS: g(['a'], '反射板: 白'), NO: g(['a'], '支柱が木製のことが多い。西海岸の南半分はさびたものも'), SE: g(['a'], '反射板: 白'), FI: g(['a'], '反射板なし'),
  EE: g(['a'], '反射板なし（バルト 3 国で唯一）'), LV: g(['a'], '反射板: 白または赤'), LT: g(['a'], '反射板: オレンジ'),
  RU: g(['a'], '反射板: 赤。黒白の縞に塗られたものも多い'), UA: g(['a'], '反射板: 赤。黒白に塗られたものも'),
  GB: g(['a'], '反射板なし'), IE: g(['a', 'b'], '反射板なし'), FR: g(['a'], '反射板: 白またはなし。北部の高速道路では細い B も'),
  ES: g(['a'], '反射板: 黄（セウタは黒白・赤）'), PT: g(['a'], '反射板: 赤'), AD: g(['a'], '反射板: 黄'), BE: g(['a'], '反射板: 黄'),
  NL: g(['a'], '反射板なし'), LU: g(['a'], '反射板: 白'), DE: g(['a', 'b'], '反射板なし。多くは B、北西部・ラインラント＝プファルツ・バイエルンの一部は A'),
  DK: g(['b'], '反射板なし'), PL: g(['b'], '反射板: 赤（丸い）'), CZ: g(['b-thin'], '反射板: 赤。ほぼすべて細い B'), SK: g(['b-thin'], '反射板: 赤。ほかの種類もときどき'),
  AT: g(['a'], '反射板: 赤'), CH: g(['a'], '反射板なし'), LI: g(['a'], '反射板なし'), IT: g(['a'], '反射板: 赤（オレンジも）。二重のガードレールが多く、端は平たく広がって外へ曲がる'),
  SI: g(['a'], '反射板: 赤。縁が丸い（B を使うクロアチアとの見分けに）'), HR: g(['b'], '反射板: 赤'), RS: g(['b'], '反射板: 赤。B のみ'), ME: g(['a', 'b'], '反射板: 赤。さびていることが多い'),
  AL: g(['a'], '反射板: 赤。端が平たく広がって外へ曲がる'), MK: g(['a'], '反射板: 赤'), GR: g(['a'], '反射板: 赤'), BG: g(['a'], '反射板: 赤'), RO: g(['a'], '反射板: 赤'),
  HU: g(['a'], '反射板: 赤'), TR: g(['a', 'b'], '反射板: 赤'), MT: g(['a'], '反射板: オレンジと赤'), FO: g(['a'], '反射板: 黄（北ヨーロッパで唯一）'),
  // そのほか（Plonkit の各国ガイド）
  IL: g(['a', 'b'], 'A と B の両方が多い（中東で B が多いのはほかにトルコだけ）'), VN: g(['a']),
  JP: g(['a-white'], '白いガードレールが基本。山口県は黄色'),
  US: g(['a'], 'ニューヨーク州・ワイオミング州は角形（ボックスビーム）が多い。国立公園は茶色'),
  CA: g(['a'], 'ブリティッシュコロンビア州はコンクリート。オンタリオ州はワイヤー、ニューファンドランドは木の支柱の先がピラミッド形'),
  AR: g(['a'], '黄と赤の長方形の反射板'), UY: g(['a'], '黄または赤の小さな長方形の反射板（支柱の形でアルゼンチンと区別）'),
  PE: g(['a'], '黒と黄の縞模様'), BO: g(['a'], '黄と黒の模様のことも'), EC: g(['a'], '二重のガードレールが多い。グアヤス州は黒黄'),
  KG: g(['concrete'], 'コンクリートの防護壁が多い'),
};

// ---- 電柱
export const POLE_TYPES = [
  { id: 'wood', name: '木製', color: '#8d5a2b' },
  { id: 'round', name: '丸いコンクリート', color: '#adb5bd' },
  { id: 'square', name: '四角いコンクリート', color: '#5c677d' },
  { id: 'holey', name: '穴あき（大きな穴が貫通）', color: '#f76707' },
  { id: 'pinhole', name: '小さな穴が縦に並ぶ四角い柱', color: '#fab005' },
  { id: 'ladder', name: 'はしご状のくぼみ（ワッフル）', color: '#4263eb' },
  { id: 'indent', name: '縦に溝がある柱', color: '#15aabf' },
  { id: 'octagonal', name: '八角形', color: '#be4bdb' },
  { id: 'metal', name: '金属（格子・鉄柱）', color: '#2b8a3e' },
  { id: 'none', name: 'ほとんど見ない', color: '#212529' },
];
const p = (types, note) => ({ types, ...(note ? { note } : {}) });
export const POLE_DATA = {
  CA: p(['wood'], '上に少し持ち上がった碍子（がいし）は北米の手がかり'), US: p(['wood'], '上に少し持ち上がった碍子は北米の手がかり'),
  GB: p(['wood'], '横に棒状の足場（ステップ）'), IE: p(['wood'], '黄色の警告ステッカーでイギリスと区別'), AT: p(['wood'], '丸い木製が最も多い'),
  EE: p(['wood', 'square'], 'バルト 3 国でいちばん種類がばらばら'), GR: p(['wood'], '濃い茶色で背が高い。碍子 5 つが縦に並ぶことも'), CY: p(['wood'], '濃い茶色で背が高い（ギリシャと同じ）'),
  SZ: p(['wood'], '濃い茶色'), GH: p(['wood'], '金属の横木に碍子 3 つ'), AE: p(['wood'], '濃い茶色。横の金属の棒に碍子 3 つ'), OM: p(['wood'], '上に金属の三角があるものはオマーンだけ'),
  MP: p(['wood']), MN: p(['wood'], '根元を石のブロックで支える'), HK: p(['wood'], '郊外のみ。都市部ではほぼ見ない'), CW: p(['wood'], '横に 3 つ交互に並ぶ碍子'),
  IT: p(['round'], 'コンクリートの三叉の頂部が多い。木製には白いステッカー'), SM: p(['round', 'wood']), JP: p(['round'], 'ねじのような足場ボルト。地域ごとに違う番号札'),
  CZ: p(['round'], '太い丸柱を 2 本組にすることが多い'), SK: p(['round'], '太い丸柱を 2 本組にすることが多い'), ME: p(['round', 'wood']),
  EC: p(['round', 'ladder'], 'はしご状の柱は中南米ではエクアドルにほぼ限られる'), BG: p(['round'], '鉤形の碍子が交互に'), GU: p(['round'], 'とても太いことが多い'),
  PA: p(['round']), BO: p(['round', 'wood'], '上の方に小さな穴。ばらつきが大きい'), HR: p(['round', 'wood'], '木製には交互の鉤形の碍子'),
  AR: p(['round', 'wood'], '電線 3 本が交互に。2 本組の柱も'), ID: p(['round', 'metal'], '黒い鉄柱にインドネシア国旗の色'), JO: p(['round']),
  RU: p(['square'], '根元にコンクリートの支え'), UA: p(['square'], '根元が白く塗られることも。斜めの支柱'), LT: p(['square'], '斜めの支柱が多い'),
  DO: p(['square'], '上が逆 L 字。四角い柱は南北アメリカでは珍しい'), IN: p(['square'], '三叉の頂部が多い。木製はほぼない'), NP: p(['square', 'metal'], '山地は細い鉄柱'),
  KZ: p(['square'], 'ロシアに似る'), KG: p(['square'], '根元を白く塗る'), GE: p(['square']),
  PL: p(['holey'], '穴が根元まで続かない。2 本組や A 字形も'), HU: p(['holey', 'wood'], '穴が細く、根元まで続く'), RO: p(['holey', 'round'], '穴が大きく、根元まで続く'),
  VN: p(['holey', 'round'], 'アジアで穴あき柱が多いのはほかにスリランカだけ'), LK: p(['pinhole', 'holey'], '下半分に大きな穴のある柱はスリランカ特有'),
  TH: p(['pinhole'], '街灯の柱の根元は赤黒・黒白の縞'), LA: p(['pinhole']), BE: p(['pinhole'], '楕円の穴の柱も多い'),
  FR: p(['ladder', 'wood'], '小さな青い長方形の印はフランス特有'), PT: p(['ladder'], 'はしごの段が高い（スペイン・フランスは低い）'), ES: p(['ladder', 'wood']),
  BR: p(['ladder', 'round'], '下の方がはしごに似る。南部は丸い柱も'), KH: p(['ladder', 'round']), NG: p(['ladder'], 'ブラジルに似るが穴は貫通しない'),
  RE: p(['ladder'], 'フランスと同じ設備'), SN: p(['ladder'], 'フランスと同じ設備'), ST: p(['ladder', 'wood'], 'ポルトガルと同じはしご状'),
  CL: p(['indent', 'wood'], '両側に溝のある四角い柱'), NZ: p(['indent'], '長い溝が 1 本。銀色のポッサムよけ'),
  MX: p(['octagonal'], 'コロンビアでも八角形が多い'), PH: p(['metal', 'indent'], '八角形の鉄柱が多い'),
  TR: p(['metal'], 'はしご状・格子状の鉄柱がとても多い'), LB: p(['metal', 'wood'], '格子状の鉄柱を黄色に塗ることも'), IL: p(['metal'], '根元が黒白の縞。格子状の柱'),
  FI: p(['wood'], '木製が基本。街灯は柱の上に 2 本のボルトで留める'), DE: p(['wood', 'round'], '木製には白い長方形のステッカー。丸いコンクリートは旧東ドイツにほぼ限られる'),
  KE: p(['round', 'wood'], 'コンクリートか木製で、L 字の横木。どくろの危険表示も'), QA: p(['round'], '碍子 3 つで真ん中が少し高い。横木に斜めの支え 2 本'),
  AU: p(['wood', 'round'], '州によって違う: 南オーストラリアは鉄とコンクリートの「Stobie pole」、ビクトリアはコンクリートが多い、北部準州はさびた穴あきの鉄柱'),
  BT: p(['metal'], '細い鉄柱'), NL: p(['none'], '街なかの電柱はほぼない'), DK: p(['none'], '街なかの電柱は少ない'),
  // GeoHints の電柱の写真から判断（Plonkit に記述のない国。POLE_PHOTO）
  BA: p(['round'], '写真から判断'), BD: p(['square'], '写真から判断'), BW: p(['wood'], '写真から判断'), CH: p(['wood'], '写真から判断'),
  CO: p(['round'], '黒黄・黒オレンジの縞の印。暗い色の柱も多い'), CR: p(['round'], '横木が低く、碍子が片側 1・反対側 2 のことが多い'), CX: p(['wood'], '写真から判断'),
  FO: p(['round'], '写真から判断'), GL: p(['metal'], '写真から判断'), IS: p(['wood'], '写真から判断（H 形の木製）'), KR: p(['round'], '根元に黒と黄の斜めの縞。先がとがった頂部'),
  LI: p(['wood'], '写真から判断'), LS: p(['wood'], '写真から判断'), LU: p(['round'], '逆さの三叉の頂部が多い'), LV: p(['round'], '鉤形の碍子が左右交互に並ぶ'),
  MG: p(['ladder'], '写真から判断'), ML: p(['ladder'], '写真から判断'), MT: p(['wood'], '写真から判断'), MY: p(['round'], '黒いステッカー（ボルネオのサラワクは白）'),
  NO: p(['wood'], '写真から判断'), PE: p(['round'], '下の方を塗った柱。北部は黄色の縦の番号'), PM: p(['ladder'], 'フランスと同じ'), PR: p(['square'], '四角い柱は南北アメリカでは珍しい'),
  PY: p(['ladder'], 'ブラジルに似たはしご状'), RS: p(['wood', 'metal'], '写真から判断'), RW: p(['round', 'wood'], '写真から判断'), SE: p(['wood'], '写真から判断'),
  SI: p(['wood'], 'A 字形の木製も'), TN: p(['round'], '写真から判断'), TW: p(['round'], '根元から黒と黄の斜めの縞。青い座標プレート'), UG: p(['wood'], '写真から判断'),
  UY: p(['round', 'square'], '碍子 3 つが上を向く「三叉」の頂部。四角いコンクリートも'), ZA: p(['round', 'wood'], '横棒に白い碍子が並ぶ「バードポール」'),
};

// ---- 道路の線（GeoHints https://geohints.com/meta/lines の国別データ）
// yw: 外側の線が黄・中央線が白 / ww: 外側白・中央白 / wy: 外側白・中央黄 / yy: 外側黄・中央黄 / wwy: 外側白・中央は白と黄
export const LINE_SRC = { name: 'GeoHints', url: 'https://geohints.com/meta/lines' };
export const LINE_TYPES = [
  { id: 'ww', name: '外側 白・中央 白', color: '#e9ecef', edge: '#ffffff', center: '#ffffff' },
  { id: 'wy', name: '外側 白・中央 黄', color: '#fab005', edge: '#ffffff', center: '#fcc419' },
  { id: 'yw', name: '外側 黄・中央 白', color: '#4dabf7', edge: '#fcc419', center: '#ffffff' },
  { id: 'yy', name: '外側 黄・中央 黄', color: '#e8590c', edge: '#fcc419', center: '#fcc419' },
  { id: 'wwy', name: '外側 白・中央 白と黄', color: '#9775fa', edge: '#ffffff', center: '#fcc419' },
];
const LINE_RAW = `AD:ww AE:yw,yy AL:ww,wy AR:ww,wy,wwy AS:wy AT:ww,wy AU:yw,ww,yy BA:ww BD:ww BE:ww BG:ww BO:ww,wy BR:ww,wy,yy BT:ww BW:yw CA:wy CH:yw,ww CL:yw,ww,wy,yy CO:wy CR:wy CW:ww CX:ww CY:ww CZ:ww DE:ww DK:ww DO:wy EC:wy EE:ww EG:ww ES:yw,ww,wy FI:ww,wy,wwy FO:ww FR:yw,ww,wwy GB:yw,ww GE:ww GH:ww GI:yw,ww GL:ww GR:ww,wy GT:wy GU:wy HR:ww HU:yw,ww ID:ww,wy,yy IE:yw IL:yw IM:yw,ww IN:yw,ww,yy IS:ww IT:ww JE:yw JO:yw JP:ww,wy,wwy KE:ww,wy KG:ww KH:wy KR:ww,wy,yy KZ:yw,ww LA:ww LB:wy LI:ww LK:yw,ww LS:yw LT:yw,ww LU:ww LV:ww MC:ww ME:yw,ww MG:ww MK:ww,yy MN:ww MP:wy MT:ww MX:yw,ww,wy MY:yw,ww NA:yw NG:yw NL:ww NO:wy NP:yw NZ:yw,ww,wy,yy,wwy OM:yw,yy PA:wy PE:ww,wy PH:ww,wy,wwy PL:ww PR:wy PS:yw PT:yw,ww PY:wy QA:ww,wy RE:ww RO:ww,yy RS:ww RU:yw,ww,wy RW:ww,wy SE:ww SG:yw,ww SI:ww SK:ww SM:ww SN:ww ST:ww SZ:yw TH:wy TN:ww TR:yw,ww,wy,yy,wwy TW:wy,yy UA:ww UG:ww,wy US:wy UY:ww,wwy VN:ww,wy,wwy XK:ww ZA:yw`;
export const LINE_DATA = Object.fromEntries(LINE_RAW.split(' ').map((x) => { const [c, t] = x.split(':'); return [c, { types: t.split(',') }]; }));

// ---- Google カーのカメラ世代（GeoHints https://geohints.com/meta/cameraGens）
// 1〜4: Gen 1〜4 / b: Bad Cam / l: Low Cam / s: Small Cam / t: トレッカー
export const CAM_SRC = { name: 'GeoHints', url: 'https://geohints.com/meta/cameraGens' };
const CAM_RAW = `AD:23t AE:34t AF:t AL:3s AR:34st AS:3t AT:234blst AU:1234t AX:23t BA:4s BD:34bt BE:234st BG:34bt BM:3t BO:34t BR:234st BT:3 BW:3 BY:3t BZ:t CA:1234st CC:3t CH:234lst CL:34t CN:t CO:34t CR:4t CW:3t CX:3t CY:bs CZ:234bst DE:234blst DK:234bst DO:3 EC:34bt EE:34bt EG:t ES:234bst FI:234bst FK:t FO:34t FR:1234blst GB:234bst GE:4s GH:34st GI:3 GL:3t GM:4 GR:234bst GS:t GT:3t GU:3t GY:3 HK:234t HR:34bt HU:234t ID:34t IE:234bst IL:234t IM:2t IN:3bst IQ:t IS:34t IT:1234blst JE:2 JO:3t JP:1234lt KE:34t KG:3t KH:3bt KR:23t KZ:34 LA:3t LB:blt LI:4bl LK:34bl LS:3 LT:34bt LU:234st LV:34bt MC:1234st ME:3s MG:3t MK:3s ML:t MM:t MN:34t MO:2 MP:3t MT:34t MX:1234t MY:34t NA:4 NG:34bt NI:4 NL:234st NO:234bst NP:bt NZ:1234t OM:4 PA:4 PE:34st PH:34t PK:3t PL:234bst PN:t PR:3st PS:34t PT:234bst PY:34s QA:4t RO:234bt RS:34s RU:234t RW:4 SE:234bst SG:234t SI:234bst SK:34bst SM:234t SN:34t ST:b SY:3 SZ:3 TH:34t TN:3t TR:34st TW:234t TZ:34t UA:3 UG:3t US:1234bst UY:34st VE:34s VI:3t VN:34bt VU:t XK:4s ZA:234st`;
export const CAM_DATA = Object.fromEntries(CAM_RAW.split(' ').map((x) => { const [c, f] = x.split(':'); return [c, f]; }));

// ---- 雪のカバレッジ（GeoHints https://geohints.com/meta/snow）o: 屋外 / i: 屋内のみ / b: 屋外と屋内
export const SNOW_SRC = { name: 'GeoHints', url: 'https://geohints.com/meta/snow' };
const SNOW_RAW = `AD:o AE:i AR:o AT:o AU:o BA:o BE:o BG:o BO:o CA:o CH:o CL:o CO:o CY:o CZ:o DE:o DK:o EC:o EE:o ES:o FI:o FO:o FR:o GB:o GE:o GL:o GR:o GS:o HR:o HU:o IE:o IN:o IS:o IT:o JP:o KG:o KR:o KZ:o LB:o LT:o LU:o LV:o MK:o MN:o MX:o NL:o NO:o NP:o NZ:o PE:o PL:o PT:o RO:o RS:o RU:b SE:o SI:o SK:o SM:o TR:o TW:o TZ:o UA:o US:o XK:o ZA:o`;
export const SNOW_DATA = Object.fromEntries(SNOW_RAW.split(' ').map((x) => x.split(':')));

// 電柱のうち、GeoHints の写真から種類を判断した国（出典の表示用）
export const POLE_PHOTO = new Set('BA BD BW CH CO CR CX FO GL IS KR LI LS LU LV MG ML MT MY NO PE PM PR PY RS RW SE SI TN TW UG UY ZA'.split(' '));

// ---- ナンバープレート（GeoHints https://geohints.com/meta/licensePlates の自家用車の画像の色を読み取ったもの）
export const PLATE_SRC = { name: 'GeoHints', url: 'https://geohints.com/meta/licensePlates' };
export const PLATE_TYPES = [
  { id: 'w-eu', name: '白・左に青い帯（EU 式）', color: '#1971c2' },
  { id: 'y-eu', name: '黄・左に青い帯', color: '#e67700' },
  { id: 'mercosur', name: '白・上に青い帯（メルコスール）', color: '#22b8cf' },
  { id: 'w', name: '白', color: '#e9ecef' },
  { id: 'wy', name: '前が白・後ろが黄', color: '#fcc419', stripes: ['#f8f9fa', '#fcc419'] },
  { id: 'y', name: '黄', color: '#fab005' },
  { id: 'k', name: '黒', color: '#212529' },
  { id: 'b', name: '青', color: '#364fc7' },
  { id: 'r', name: '赤', color: '#e03131' },
  { id: 'design', name: '絵柄入り（地域ごとに違う）', color: '#be4bdb' },
];
const PLATE_RAW = `
BW:wy EG:w SZ:design GH:w KE:wy LS:w MG:k NA:y NG:w RW:wy SN:b ZA:w ST:k TN:k UG:wy
BD:w BT:r KH:w CX:y CC:w IN:w ID:k IL:y JP:w JO:w KZ:w KG:w LA:y LB:w MY:k MN:w NP:w OM:y PK:w PH:w QA:w
RU:w SG:wy KR:w LK:wy TW:w TH:w AE:w VN:w
AL:w-eu AD:w AT:w-eu BE:w-eu BA:w-eu BG:w-eu HR:w-eu CY:w-eu CZ:w-eu DK:w-eu EE:w-eu FO:w-eu FI:w-eu FR:w-eu GE:w-eu
DE:w-eu GI:wy GR:w-eu HU:w-eu IS:w-eu IE:w-eu IM:wy IT:w-eu JE:wy XK:w-eu LV:w-eu LI:k LT:w-eu LU:y-eu MT:w-eu MC:w
ME:w-eu NL:y-eu MK:w-eu NO:w-eu PL:w-eu PT:w-eu RO:w-eu SM:w RS:w-eu SK:w-eu SI:w-eu ES:w-eu SE:w-eu CH:w TR:w-eu
UA:w-eu GB:wy BM:w CR:w CW:w GL:w GT:w VI:design AS:design AU:design GU:w NZ:w
AR:mercosur BO:mercosur BR:mercosur CL:w CO:y EC:w PY:mercosur PE:w UY:mercosur
`;
export const PLATE_DATA = Object.fromEntries(PLATE_RAW.trim().split(/\s+/).map((x) => { const [c, t] = x.split(':'); return [c, { types: [t] }]; }));

// ---- ボラード（GeoHints https://geohints.com/meta/bollards の写真から、本体と帯の色でおおまかに分類し、
//      Plonkit の各国ガイドの記述と照らし合わせて修正。2026-10 時点）
// 反射板の形や色など細かい違いは国ごとに異なるので、写真で確認してください
export const BOLLARD_SRC = { name: 'GeoHints・Plonkit', url: 'https://geohints.com/meta/bollards' };
// bg: 地図でイラストを敷き詰めるときの地の色（種類ごとに違う色）
export const BOLLARD_TYPES = [
  { id: 'wk', name: '白・黒い帯（反射板つき・ヨーロッパ型）', color: '#868e96', body: '#f8f9fa', band: '#212529', bg: '#868e96' },
  { id: 'wr', name: '白・赤い帯や反射板', color: '#e03131', body: '#f8f9fa', band: '#e03131', bg: '#a61e1e' },
  { id: 'wy', name: '白・黄 / オレンジの帯や反射板', color: '#fcc419', body: '#f8f9fa', band: '#fcc419', bg: '#d9480f' },
  { id: 'wg', name: '白・緑の帯', color: '#2f9e44', body: '#f8f9fa', band: '#2f9e44', bg: '#2b8a3e' },
  { id: 'wb', name: '白・青い印', color: '#1c7ed6', body: '#f8f9fa', band: '#1c7ed6', bg: '#1864ab' },
  { id: 'w', name: '白（帯なし・小さな反射板）', color: '#f1f3f5', body: '#f8f9fa', band: '#dee2e6', bg: '#5c636a' },
  { id: 'skw', name: '黒白の縞', color: '#495057', body: '#f8f9fa', band: '#212529', stripes: ['#f8f9fa', '#212529'], bg: '#e8590c' },
  { id: 'srw', name: '赤白の縞', color: '#fa5252', body: '#f8f9fa', band: '#e03131', stripes: ['#f8f9fa', '#e03131'], bg: '#862e9c' },
  { id: 'syk', name: '黄黒の縞', color: '#fab005', body: '#fcc419', band: '#212529', stripes: ['#fcc419', '#212529'], bg: '#0b7285' },
  { id: 'y', name: '黄色', color: '#ffd43b', body: '#ffd43b', band: '#fab005', bg: '#3b5bdb' },
  { id: 'sy', name: '灰色・黄色い帯', color: '#adb5bd', body: '#adb5bd', band: '#fcc419', bg: '#5f3dc4' },
  { id: 'k', name: '黒・濃い色', color: '#212529', body: '#343a40', band: '#495057', bg: '#ced4da' },
  { id: 'b', name: '青', color: '#1864ab', body: '#1864ab', band: '#e03131', bg: '#a5d8ff' },
  { id: 'r', name: '赤・オレンジ', color: '#c92a2a', body: '#e8590c', band: '#c92a2a', bg: '#ffc9c9' },
  { id: 'c', name: 'コンクリートの塊', color: '#c2a878', body: '#e9ecef', band: '#868e96', bg: '#8d6e4f' },
];
const BOLLARD_RAW = `
GH:wr KE:c LS:w NA:wy NG:wk RW:wr RE:wr SN:wr TN:wb UG:w BD:srw BT:c KH:srw CX:wr CC:b IN:skw ID:skw IL:wk
JP:w KZ:wk KG:wk LA:skw LB:wr MY:wr MN:wr NP:skw OM:wr PH:syk QA:srw RU:wk KR:w LK:c TW:wk TH:skw AE:srw VN:wr
AL:wk AD:wy AT:wk BY:k BE:wy BA:wk BG:wk HR:wk CY:wr CZ:wk DK:wy EE:w FO:y FI:wk FR:wr GE:wk DE:wk GR:wk
HU:wk IS:y IE:wg IM:wk IT:wk JE:k XK:wk LV:wk LI:wk LT:wk LU:wk MT:wk MC:wr ME:wk NL:wr MK:wk NO:wk PL:wr
PT:wk RO:wr SM:wk RS:wr SK:wk SI:wk ES:wy SE:wk CH:wk TR:wr UA:wk GB:wk CA:skw CR:r GT:skw MX:wk PA:w AU:wr
NZ:wr AR:wg BO:wr BR:wr CL:wy CO:wy EC:wr PE:r UY:wy HK:y SG:syk
`;
// 国ごとの見分け方（Plonkit の各国ガイドより）
const BOLLARD_NOTE = {
  AL: '上部が黒、反射板は赤と灰色（イタリアと同じ）',
  AD: 'オレンジの反射板（スペインでも見られる）',
  AU: '白、前が赤・後ろが灰色の反射板（赤は途中まで。ニュージーランドは一周する）',
  AT: '白で上部が黒。上に黒い小さな突起があることも。反射板は暗い赤・灰色',
  BD: '赤白のコンクリート製',
  BE: '白に黄色の長方形の反射板（後ろは白）。濃い茶色に赤い線 2 本の型も',
  BG: 'あまり見かけない。クロアチア・ハンガリーに似た型',
  KH: '赤白の縞の石製、または上が赤・下が白の石製',
  CA: 'アルバータ州の黒白の型（交差点に多い）。州によって違う',
  CL: 'スペイン型（前が白・後ろが黄オレンジの反射板）。あまり見かけない',
  CX: 'オーストラリアと同じ（白に赤い反射板）',
  CR: '黒い丸が 3 つのオレンジの板。国道 32 号は黄色のボラード',
  HR: '白に黒い長方形、反射板は赤か白。角がとがっている（ハンガリー・リトアニアは丸い）',
  CY: '前が赤・後ろが白の反射板。三角形で上が斜め',
  CZ: '前にオレンジの反射板が 2 つ、後ろは白が 1 つ',
  DK: '白に黄色の反射板と濃いオレンジの線（デンマーク特有）',
  EC: '赤い線 2 本の丸い型と、黒地に赤い反射板 2 つの平らな型',
  EE: '丸い棒のような形（バルト 3 国で違う）',
  FO: '黄色に塗った木の棒。上が赤いことも',
  FI: '長い黒白。前は白い長方形、後ろは点 2 つの反射板',
  FR: '白に赤い帯、上がとがった丸い型（とてもよく見る）',
  DE: '黒白。反射板は白・薄い灰色（交差点の近くはオレンジ）',
  GR: 'くさび形で、ほぼ正方形の反射板（前が赤・後ろが白）',
  GT: '白に黒い線 2 本（ケツァルテナンゴの北東）',
  HK: '青い丸に白い矢印の黄色いボラード（横断歩道など）',
  HU: '黒白のくさび形、前が赤・後ろが白の反射板（クロアチアに似る）',
  IS: '黄色に白い反射板（ほぼすべての郊外の道路）',
  ID: '黒白の四角・丸い型と、黄黒の型',
  IE: '緑と白',
  IM: '街なかは青いボラード',
  IT: '三角形で白、上部が黒（アルバニアと同じ）',
  JP: '白に丸い反射板。黒や別の形のことも',
  KZ: '旧ソ連型とトルコ型の両方',
  KG: '白に斜めの黒い線',
  LA: '黒白の帯の四角いコンクリート',
  LV: '細くて少し曲がった形。反射板の下に番号',
  LS: '白く塗った棒',
  LI: '黒白の丸い型、反射板は白か灰色（スイスとほぼ同じ）',
  LT: 'くさび形、オレンジの反射板',
  LU: '黒白（ドイツとほぼ同じ。反射板のボルトが 3 本）',
  MY: '黒・白・灰色・赤の組み合わせ',
  MX: '白で根元が黒の丸い型（メキシコ特有）',
  MN: 'ボウリングのピン形で、上に赤い線 2 本（モンゴル特有）',
  ME: '白で上部が黒、前が赤・後ろが白の反射板（スロベニアと同じ）',
  NA: '白に黄色の反射板 2 つ（後ろは赤）。小さな石のボラードも',
  NP: '黒白の縞のコンクリート。上に赤い印',
  NL: '白に赤い反射板',
  NZ: '上に赤い帯が一周（ニュージーランド特有）',
  MK: 'クロアチアと同じくさび形',
  NO: '細く曲がった長方形、反射板は黒い平行四辺形の中',
  PE: '赤か黄に塗った三角形のコンクリート',
  PL: '赤い帯が一周する（細く曲がった型も）',
  PT: '上の白い部分が細いくさび形、または幅の広い反射板の平らな型',
  RO: '細い白、上の方に赤い縦の線（あまり見かけない。トルコに似る）',
  RU: '上部が黒で赤い縦の反射板の型、細い棒の型、ドイツ型の 3 種類。交差点にとても多い',
  RW: '赤白の丸い型が何種類か',
  RS: '反射板が中央からずれた平らな型が多い',
  SG: 'バス停に黒黄の帯のコンクリート',
  SK: '前にオレンジの反射板 2 つ（新しい型は前が赤）',
  SI: '白で上部が黒、前が赤（オーストリアは暗い赤）',
  KR: '白い本体。裏の反射板が灰色（写真で灰色に見えるのはこの面）。黒白のくさび形も',
  ES: '前が黄オレンジ、後ろは白い点 2 つ',
  LK: '背の低い幅広の石のボラード（スリランカ特有）',
  SE: '黒白で反射板は灰色。南部はくさび形、北部は黒い横帯の丸い型',
  CH: '黒白、反射板は白か灰色',
  TW: '黒い長方形に丸い反射板が 2〜3 つ',
  TH: '上がとがった四角い黒白の縞',
  TR: '白い長方形に赤い反射板',
  UA: 'ザカルパッチャ州はポーランド型（赤い帯が一周）',
  GB: 'スコットランドは赤白の丸い型（上が丸い）',
  UY: '片側が黄色く塗られた白いボラード',
  VN: '白で上が赤の四角いコンクリート',
  SM: 'イタリアと同じ',
  SN: 'フランスと同じ',
  RE: 'フランスと同じ（サン・ポールは黒、サン・ドニは緑）',
};
export const BOLLARD_DATA = Object.fromEntries(BOLLARD_RAW.trim().split(/\s+/).map((x) => { const [c, t] = x.split(':'); return [c, { types: [t], ...(BOLLARD_NOTE[c] ? { note: BOLLARD_NOTE[c] } : {}) }]; }));
