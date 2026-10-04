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
  UY: p(['round'], '碍子 3 つが上を向く「三叉」の頂部'), ZA: p(['round', 'wood'], '横棒に白い碍子が並ぶ「バードポール」'),
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
