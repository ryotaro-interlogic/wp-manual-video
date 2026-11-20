// deck.json（スライドの設計図）から操作マニュアルの pptx を作り、動画用に赤枠の位置を marks.json に書き出す。
//   NODE_PATH=<node_modules> node build_deck.js path/to/deck.json
// 書式は references/deck-spec.md を参照。
const fs = require('fs');
const path = require('path');
const pptxgen = require('pptxgenjs');
const sharp = require('sharp');
const W = require('./jwrap'); // 日本語の改行（文節の切れ目と禁則を守る）

const deckFile = path.resolve(process.argv[2] || 'deck.json');
const DIR = path.dirname(deckFile);
const deck = JSON.parse(fs.readFileSync(deckFile, 'utf8'));
const SHOTS = path.resolve(DIR, deck.shotsDir || 'shots');
const RECT = fs.existsSync(path.resolve(DIR, deck.rects || 'rects.json')) ? JSON.parse(fs.readFileSync(path.resolve(DIR, deck.rects || 'rects.json'), 'utf8')) : {};
const SRC_W = 1440; // 撮影時の画面幅（論理ピクセル）

// site_design.js がサイトから読み取った配色・書体・角の丸さ（design.json）。無ければ既定の見た目で作る。
// "design": false で読み込まない。deck.json の colors / font を書いた場合はそちらを優先する。
const DESIGN_FILE = deck.design === false ? null : path.resolve(DIR, deck.design || 'design.json');
const DESIGN = DESIGN_FILE && fs.existsSync(DESIGN_FILE) ? JSON.parse(fs.readFileSync(DESIGN_FILE, 'utf8')) : {};
// 色を白と混ぜて薄くする（t = 白の割合）
const mix = (c, t) => [0, 2, 4].map(i => Math.round(parseInt(c.slice(i, i + 2), 16) * (1 - t) + 255 * t).toString(16).padStart(2, '0')).join('').toUpperCase();
const FROM_DESIGN = {};
if (DESIGN.primary) Object.assign(FROM_DESIGN, { orange: DESIGN.primary, peach: mix(DESIGN.primary, 0.88), subtitle: mix(DESIGN.primary, 0.55) });
if (DESIGN.dark) FROM_DESIGN.navy = DESIGN.dark;
// メインの色が赤系のとき（目印を青にしたとき）は、「ポイント」の枠を「注意」の赤い枠と見分けられるようグレーにする
if (DESIGN.mark) Object.assign(FROM_DESIGN, { mark: DESIGN.mark, peach: 'F2F4F7' });
// orange：メインの色（手順の番号・ポイント）、mark：画面上のクリック場所の目印、red：注意
const HEX = Object.assign({ orange: 'E2652B', red: 'D92D20', mark: 'D92D20', navy: '1E2A44', gray: '5B6472', light: 'F2F4F7', peach: 'FCE9DD', warn: 'FDECEA', text: '3A4250', sub: 'C9D1DE', subtitle: 'F8C9AE' }, FROM_DESIGN, deck.colors || {});
const FONT = deck.font || DESIGN.font || 'Meiryo';
// 角の丸さ（インチ）。0 なら四角
const RADIUS = typeof DESIGN.radius === 'number' ? DESIGN.radius : 0.08;
const boxShape = () => RADIUS > 0 ? pres.shapes.ROUNDED_RECTANGLE : pres.shapes.RECTANGLE;
const round = k => (RADIUS > 0 ? { rectRadius: RADIUS * k } : {});

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5
pres.title = deck.title;
if (deck.author) pres.author = deck.author;
pres.theme = { headFontFace: FONT, bodyFontFace: FONT };

// ロゴ（ユーザーから受け取った画像）。logo は白い背景用で中身のページの下の真ん中に、logoDark は濃い背景用で表紙と章の扉に置く。
// どちらも deck.json からの相対パス。logoDark が無ければ表紙と扉にはロゴを置かない（白い背景用のロゴが濃い背景で見えなくなるため）。
async function logoImage(file, maxW, maxH) {
  if (!file) return null;
  const p = path.resolve(DIR, file);
  if (!fs.existsSync(p)) throw new Error(`ロゴのファイルがありません：${p}`);
  const m = await sharp(p).metadata();
  let h = maxH, w = h * m.width / m.height;
  if (w > maxW) { w = maxW; h = w * m.height / m.width; }
  return { path: p, w, h };
}

// 表紙と章の扉の背景。deck.json の coverImage（ユーザーからもらった写真など）か、site_design.js が撮ったサイトの画面（design.json の bg）を、
// 縮小して強くぼかし、文字が読めない状態にしてから使う。上に濃い色を半透明で重ねる。"coverImage": false で使わない（塗りつぶしになる）
async function coverBackground() {
  if (deck.coverImage === false) return null;
  const src = deck.coverImage ? path.resolve(DIR, deck.coverImage) : DESIGN.bg && DESIGN_FILE ? path.resolve(path.dirname(DESIGN_FILE), DESIGN.bg) : null;
  if (!src || !fs.existsSync(src)) return null;
  fs.mkdirSync(SHOTS, { recursive: true });
  const out = path.join(SHOTS, '_cover_bg.png');
  if (deck.coverImage) {
    // ユーザーの写真は少しだけぼかす
    await sharp(src).resize(1600, 900, { fit: 'cover' }).blur(2).toFile(out);
    return out;
  }
  // サイトの画面は、上の6割（ヘッダーと見出し画像のあたり）だけを使い、96×54 まで縮めてからぼかして引き伸ばす。
  // 文字の形は残らず、サイトの色の流れだけが残る
  const m = await sharp(src).metadata();
  const small = await sharp(src).extract({ left: 0, top: 0, width: m.width, height: Math.round(m.height * 0.6) })
    .resize(96, 54, { fit: 'cover' }).blur(2).toBuffer();
  await sharp(small).resize(1600, 900, { kernel: 'cubic' }).blur(6).toFile(out);
  return out;
}

let TITLE_W = 12.3; // 中身のページのタイトルの幅
async function defineMasters() {
  const onDark = await logoImage(deck.logoDark, 3.0, 0.8);
  const onLight = await logoImage(deck.logo, 1.6, 0.26);
  const bg = await coverBackground();
  // 背景の写真の上に濃い色を重ね、文字を読みやすくする（transparency は透ける割合 %）
  const dim = alpha => bg ? [{ rect: { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: HEX.navy, transparency: alpha } } }] : [];
  const back = bg ? { path: bg } : { color: HEX.navy };
  pres.defineSlideMaster({ title: 'TITLE', background: back, objects: [
    ...dim(18),
    // タイトルの左にメインの色の細い線
    { rect: { x: 0.8, y: 2.35, w: 0.07, h: 2.3, fill: { color: HEX.subtitle } } },
    ...(onDark ? [{ image: { path: onDark.path, x: 0.8, y: 0.7, w: onDark.w, h: onDark.h } }] : []),
    { placeholder: { options: { name: 'title', type: 'title', x: 1.15, y: 2.2, w: 11.4, h: 1.4, fontSize: 40, bold: true, color: 'FFFFFF', valign: 'bottom', align: 'left', margin: 0 }, text: '' } },
    { placeholder: { options: { name: 'body', type: 'body', x: 1.15, y: 3.8, w: 11.4, h: 1.2, fontSize: 18, color: HEX.subtitle, valign: 'top', align: 'left', margin: 0 }, text: '' } },
  ] });
  pres.defineSlideMaster({ title: 'SECTION', background: back, objects: [
    ...dim(14),
    ...(onDark ? [{ image: { path: onDark.path, x: 0.8, y: 0.6, w: onDark.w * 0.75, h: onDark.h * 0.75 } }] : []),
    { placeholder: { options: { name: 'title', type: 'title', x: 0.8, y: 2.95, w: 11.7, h: 1.1, fontSize: 40, bold: true, color: 'FFFFFF', valign: 'middle', align: 'left', margin: 0 }, text: '' } },
    { placeholder: { options: { name: 'body', type: 'body', x: 0.8, y: 4.15, w: 11.7, h: 0.9, fontSize: 16, color: HEX.sub, valign: 'top', align: 'left', margin: 0 }, text: '' } },
  ] });
  pres.defineSlideMaster({ title: 'CONTENT', background: { color: 'FFFFFF' }, objects: [
    // 左上の小さな色の四角（章の名前の目印）
    { rect: { x: 0, y: 0.2, w: 0.16, h: 0.3, fill: { color: HEX.orange } } },
    // ロゴは下の真ん中に小さく
    ...(onLight ? [{ image: { path: onLight.path, x: (13.333 - onLight.w) / 2, y: 7.05, w: onLight.w, h: onLight.h } }] : []),
    { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.45, w: TITLE_W, h: 0.6, fontSize: 26, bold: true, color: HEX.navy, valign: 'middle', align: 'left', margin: 0 }, text: '' } },
  ], slideNumber: { x: 12.3, y: 7.0, w: 0.6, h: 0.3, fontSize: 10, color: '8A93A3', align: 'right' } });
}

// ---- 部品
let CUR = 0;
const MARKS = [];
// lang を ja-JP にしないと、PowerPoint が英語の改行ルールで折り返し、行頭に「、」が来る
const LANG = { lang: 'ja-JP' };
const tb = { margin: 0, isTextBox: true, ...LANG };
// 折り返したときの行数（jwrap.js で実際に改行する位置と同じ計算）
const lines = (text, w, pt, bold) => W.count(text, w, pt, { bold });
// 枠の幅に合わせて改行を入れた文字列
const fill = (text, w, pt, bold) => W.fill(text || '', w, pt, { bold });

function badge(s, x, y, n, d = 0.42, color = HEX.orange) {
  s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color }, line: { color: 'FFFFFF', width: 1.5 } });
  s.addText(String(n), { x, y, w: d, h: d, fontSize: d >= 0.6 ? 18 : d > 0.4 ? 16 : 13, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', ...tb });
}
// 画面上の目印。番号の丸は枠の外（左、入らなければ右、どちらも入らなければ枠の内側の左上）に置き、画面の文字を隠さない。
// img は画面の画像の範囲（addShot が返す box）
function mark(s, r, n, img) {
  const d = 0.28, gap = 0.05;
  s.addShape(RADIUS > 0 ? pres.shapes.ROUNDED_RECTANGLE : pres.shapes.RECTANGLE, { ...r, ...(RADIUS > 0 ? { rectRadius: 0.04 } : {}), fill: { type: 'none' }, line: { color: HEX.mark, width: 1.75 } });
  const by = r.y + (Math.min(r.h, 0.5) - d) / 2;
  let bx = r.x - d - gap;
  if (img && bx < img.x) bx = r.x + r.w + gap;
  if (img && bx + d > img.x + img.w) { bx = r.x + 0.03; }
  badge(s, bx, bx === r.x + 0.03 ? r.y + 0.03 : by, n, d, HEX.mark);
  MARKS.push({ slide: CUR, n, x: r.x, y: r.y, w: r.w, h: r.h });
}
function note(s, n, x, y, w, h) {
  if (!n) return y;
  const warn = n.kind === 'warn';
  const label = { text: (warn ? '注意' : 'ポイント') + '　', options: { bold: true, color: warn ? HEX.red : HEX.orange } };
  const wr = W.wrapRuns([label, { text: n.text, options: { color: HEX.text } }], w - 0.36, 12);
  h = h || 0.3 + 0.24 * wr.lines;
  s.addShape(boxShape(), { x, y, w, h, ...round(1), fill: { color: warn ? HEX.warn : HEX.peach }, line: { color: warn ? HEX.warn : HEX.peach } });
  s.addText(wr.runs, { x: x + 0.18, y, w: w - 0.36, h, fontSize: 12, valign: 'middle', lineSpacingMultiple: 1.15, ...tb });
  return y + h;
}
function steps(s, items, x, y, w) {
  let cy = y;
  items.forEach(([head, body], i) => {
    badge(s, x, cy, i + 1, 0.42, HEX.orange);
    // 見出しが2行になったら、説明をその分下げる
    const hl = lines(head, w - 0.55, 15, true);
    const hh = 0.46 + 0.28 * (hl - 1);
    s.addText(fill(head, w - 0.55, 15, true), { x: x + 0.55, y: cy - 0.02, w: w - 0.55, h: hh, fontSize: 15, bold: true, color: HEX.navy, valign: hl > 1 ? 'top' : 'middle', ...tb });
    const bh = body ? 0.27 * lines(body, w - 0.55, 12) + 0.12 : 0;
    if (body) s.addText(fill(body, w - 0.55, 12), { x: x + 0.55, y: cy + hh, w: w - 0.55, h: bh, fontSize: 12, color: HEX.gray, valign: 'top', lineSpacingMultiple: 1.15, ...tb });
    cy += hh + 0.16 + bh + 0.2;
  });
  return cy;
}
// steps() が使う高さ（置く前に、画面と手順を縦の真ん中にそろえるために使う）
function stepsHeight(items, w) {
  return items.reduce((a, [head, body]) => {
    const hh = 0.46 + 0.28 * (lines(head, w - 0.55, 15, true) - 1);
    const bh = body ? 0.27 * lines(body, w - 0.55, 12) + 0.12 : 0;
    return a + hh + 0.16 + bh + 0.2;
  }, 0);
}
function noteHeight(n, w) {
  if (!n) return 0;
  return 0.3 + 0.24 * W.wrapRuns([{ text: 'ポイント　', options: { bold: true } }, { text: n.text, options: {} }], w - 0.36, 12).lines;
}
// 画面の画像を置いたときの大きさ（置く前に計算する）
async function shotSize(spec, w, maxH) {
  const meta = await sharp(path.join(SHOTS, spec.shot + '.png')).metadata();
  const [, , cw, ch] = spec.crop || [0, 0, SRC_W, meta.height / (meta.width / SRC_W)];
  let h = w * ch / cw;
  if (maxH && h > maxH) { h = maxH; w = h * cw / ch; }
  return { w, h };
}

// 目次のような縦の並び（flow / cards）。「01 ── 見出し　説明」を1行ずつ並べ、カードの枠は使わない。
// y〜bottom の間で、全体が縦の真ん中に来るように置く
function list(s, items, y, bottom) {
  const rowH = Math.min(1.05, (bottom - y) / items.length);
  const heads = items.map(([head]) => lines(head, 3.7, 18, true));
  const rows = items.map((_, i) => Math.max(rowH, 0.32 * heads[i] + 0.45));
  let cy = y + Math.max(0, (bottom - y - rows.reduce((a, b) => a + b, 0)) / 2);
  items.forEach(([head, body], i) => {
    const h = rows[i];
    s.addText(String(i + 1).padStart(2, '0'), { x: 0.9, y: cy, w: 0.9, h, fontSize: 26, bold: true, color: HEX.orange, valign: 'middle', ...tb });
    s.addShape(pres.shapes.LINE, { x: 1.85, y: cy + h / 2, w: 0.75, h: 0, line: { color: 'C3C9D3', width: 1 } });
    s.addText(fill(head, 3.7, 18, true), { x: 2.85, y: cy, w: 3.7, h, fontSize: 18, bold: true, color: HEX.navy, valign: 'middle', ...tb });
    if (body) s.addText(fill(body, 6.1, 13), { x: 6.75, y: cy, w: 6.1, h, fontSize: 13, color: HEX.gray, valign: 'middle', lineSpacingMultiple: 1.2, ...tb });
    cy += h;
  });
  return cy;
}
// 横に並べる手順（pair / banner）。番号・見出し・説明だけで、枠は使わない
function hsteps(s, items, y) {
  const n = items.length, cw = 12.3 / n;
  items.forEach(([head, body], i) => {
    const x = 0.5 + i * cw, w = Math.min(cw - 0.75, 3.5);
    badge(s, x, y + 0.02, i + 1, 0.42, HEX.orange);
    s.addText(fill(head, w, 15, true), { x: x + 0.55, y: y, w, h: 0.46, fontSize: 15, bold: true, color: HEX.navy, valign: 'middle', ...tb });
    if (body) s.addText(fill(body, w, 12), { x: x + 0.55, y: y + 0.5, w, h: 0.7, fontSize: 12, color: HEX.gray, valign: 'top', lineSpacingMultiple: 1.15, ...tb });
  });
}
// タイトルの「」の中（ボタン名・欄の名前）だけメインの色にする
function titleRuns(t, w, pt) {
  const runs = String(t).split(/(「[^」]*」)/).filter(Boolean).map(x => ({ text: x, options: { bold: true, color: /^「/.test(x) ? HEX.orange : HEX.navy, ...LANG } }));
  return W.wrapRuns(runs, w, pt).runs;
}

// スクリーンショットを置き、画面座標→スライド座標の変換関数を返す
async function addShot(s, spec, x, y, w, maxH) {
  const name = typeof spec === 'string' ? spec : spec.shot;
  let file = path.join(SHOTS, name + '.png');
  const meta = await sharp(file).metadata();
  const scale = meta.width / SRC_W;
  let [cx, cy, cw, ch] = spec.crop || [0, 0, SRC_W, Math.round(meta.height / scale)];
  if (spec.crop) {
    const out = path.join(SHOTS, `_crop_${name}.png`);
    await sharp(file).extract({ left: Math.round(cx * scale), top: Math.round(cy * scale), width: Math.round(cw * scale), height: Math.round(ch * scale) }).toFile(out);
    file = out;
  }
  let h = w * ch / cw;
  if (maxH && h > maxH) { h = maxH; w = h * cw / ch; }
  s.addShape(pres.shapes.RECTANGLE, { x: x - 0.02, y: y - 0.02, w: w + 0.04, h: h + 0.04, fill: { color: 'D0D5DD' }, line: { color: 'D0D5DD' } });
  s.addImage({ path: file, x, y, w, h, altText: name });
  const k = w / cw;
  const conv = (px, py, pw, ph) => {
    const pad = 5;
    const x0 = Math.max(0, px - cx - pad), y0 = Math.max(0, py - cy - pad);
    const x1 = Math.min(cw, px - cx + pw + pad), y1 = Math.min(ch, py - cy + ph + pad);
    return { x: x + x0 * k, y: y + y0 * k, w: (x1 - x0) * k, h: (y1 - y0) * k };
  };
  conv.box = { x, y, w, h };
  // marks: "撮影名.部品名" か { rect: "撮影名.部品名" } か { box: [x,y,w,h] }（画面座標）
  conv.mark = (m) => {
    if (typeof m === 'string') m = { rect: m };
    if (m.box) return conv(...m.box);
    const [shotKey, part] = m.rect.split('.');
    const r = (RECT[shotKey] || {})[part];
    if (!r) throw new Error(`rects.json に ${m.rect} がありません（スライド ${CUR}）`);
    return conv(...r);
  };
  return conv;
}

// ---- スライド
async function build() {
  await defineMasters();
  let section = 'はじめに';
  pres.addSection({ title: section });
  for (const sl of deck.slides) {
    if (sl.type === 'section') { section = sl.section || sl.title; pres.addSection({ title: section }); }
    const master = sl.type === 'cover' ? 'TITLE' : sl.type === 'section' ? 'SECTION' : 'CONTENT';
    const s = pres.addSlide({ masterName: master, sectionTitle: section });
    CUR++;
    if (sl.type === 'cover') {
      s.addText(fill(deck.title, 11.4, 40, true), { placeholder: 'title', ...LANG });
      s.addText(fill(deck.subtitle, 11.4, 18), { placeholder: 'body', ...LANG });
      if (deck.footnote) s.addText(fill(deck.footnote, 9, 13), { x: 1.15, y: 6.3, w: 9, h: 0.4, fontSize: 13, color: HEX.sub, ...tb });
      continue;
    }
    if (sl.type === 'section') {
      // 章の番号は大きな丸にせず、タイトルの上に文字で置く
      s.addText(String(sl.no).padStart(2, '0'), { x: 0.8, y: 2.3, w: 1.0, h: 0.55, fontSize: 24, bold: true, color: HEX.subtitle, valign: 'bottom', ...tb });
      s.addShape(pres.shapes.LINE, { x: 1.75, y: 2.72, w: 10.8, h: 0, line: { color: HEX.subtitle, width: 1 } });
      s.addText(fill(sl.title, 11.7, 40, true), { placeholder: 'title', ...LANG });
      s.addText(fill(sl.sub, 11.7, 16), { placeholder: 'body', ...LANG });
      continue;
    }
    // タイトルの上に、今いる章の名前を小さく出す（参考：人が作った資料の「Field Report — 〇〇」のような見出し）
    if (section !== 'はじめに') s.addText(section, { x: 0.5, y: 0.2, w: 9, h: 0.3, fontSize: 11, bold: true, color: HEX.gray, valign: 'middle', ...tb });
    s.addText(titleRuns(sl.title, TITLE_W, 26), { placeholder: 'title' });
    // タイトルの下に「この編集機能があるページ：〇〇」を小さく出す
    if (sl.where) s.addText(fill('この編集機能があるページ：' + sl.where, 12.3, 11), { x: 0.5, y: 1.04, w: 12.3, h: 0.24, fontSize: 11, color: HEX.gray, valign: 'middle', ...tb });
    if (sl.type === 'flow') {
      list(s, sl.cards, 1.45, sl.note ? 5.6 : 6.6);
      note(s, sl.note, 0.5, 5.85, 12.3);
    } else if (sl.type === 'cards') {
      list(s, sl.cards, 1.45, sl.note ? 5.6 : 6.6);
      note(s, sl.note, 0.5, 5.85, 12.3);
    } else if (sl.type === 'table') {
      const hdr = t => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: HEX.navy }, ...LANG } });
      const cols = sl.header.length;
      const colW = cols === 4 ? [2.2, 3.95, 2.2, 3.95] : Array(cols).fill(12.3 / cols);
      const rows = sl.rows.map(r => r.map((c, i) => ({ text: fill(c, colW[i] - 0.3, 14, i % 2 === 0), options: { ...LANG, ...(i % 2 === 0 ? { bold: true, color: HEX.navy, fill: { color: HEX.light } } : { color: HEX.text }) } })));
      s.addTable([sl.header.map(hdr), ...rows], { x: 0.5, y: 1.4, w: 12.3, colW, rowH: 0.62, fontSize: 14, valign: 'middle', border: { type: 'solid', pt: 1, color: 'D0D5DD' }, margin: [0, 0.15, 0, 0.15] });
      note(s, sl.note, 0.5, 1.4 + 0.62 * (rows.length + 1) + 0.35, 12.3);
    } else if (sl.type === 'banner') {
      // crop で横長に切り抜いた画面を上に、手順をそのすぐ下に置く
      const P = await addShot(s, sl, 0.5, 1.3, 12.3, 3.2);
      hsteps(s, sl.cards, P.box.y + P.box.h + 0.4);
      note(s, sl.note, 0.5, 6.35, 12.3, 0.5);
    } else if (sl.type === 'pair') {
      let n = 0;
      for (const [i, sp] of sl.shots.entries()) {
        const P = await addShot(s, sp, 0.5 + i * 6.3, 1.3, 6.0);
        for (const m of sp.marks || []) mark(s, P.mark(m), ++n, P.box);
      }
      hsteps(s, sl.steps, 5.28);
      note(s, sl.note, 0.5, 6.35, 12.3, 0.5);
    } else if (sl.type === 'shot') {
      // 縦長に切り抜いた画面は高さ優先で置き、右側を広く使う
      const tall = sl.crop && sl.crop[3] > sl.crop[2] * 0.9;
      // 画面が低いと下半分が空くので、画面と右の手順をまとめて縦の真ん中に置く（extra があるときは下に置くので上から）
      const sz = await shotSize(sl, tall ? 10 : 8.4, tall ? 5.4 : 5.55);
      const sx0 = tall ? 0.9 + sz.w + 0.7 : 9.25;
      const rightH = stepsHeight(sl.steps || [], 12.85 - sx0) + (sl.note ? 0.1 + noteHeight(sl.note, 12.85 - sx0) : 0);
      const y0 = sl.extra ? 1.3 : 1.3 + Math.max(0, (6.85 - 1.3 - Math.max(sz.h, rightH)) / 2);
      const P = tall ? await addShot(s, sl, 0.9, y0, 10, 5.4) : await addShot(s, sl, 0.5, y0, 8.4, 5.55);
      (sl.marks || []).forEach((m, i) => mark(s, P.mark(m), i + 1, P.box));
      const sx = tall ? P.box.x + P.box.w + 0.7 : 9.25;
      const sw = 12.85 - sx;
      const end = steps(s, sl.steps || [], sx, y0 + 0.05, sw);
      if (end > 7.0) console.warn(`スライド${CUR}「${sl.title}」：手順が下にはみ出しそうです。説明を削るか、手順を分けてください`);
      if (sl.extra) {
        const y = Math.max(end, 5.4);
        s.addShape(boxShape(), { x: sx, y, w: sw, h: 1.3, ...round(1), fill: { color: HEX.light }, line: { color: HEX.light } });
        const ex = W.wrapRuns([
          { text: sl.extra.head, options: { bold: true, color: HEX.navy, breakLine: true } },
          ...sl.extra.lines.map((l, i) => ({ text: l, options: { color: i === sl.extra.lines.length - 1 && sl.extra.accentLast ? HEX.orange : HEX.gray, bold: i === sl.extra.lines.length - 1 && sl.extra.accentLast, breakLine: i < sl.extra.lines.length - 1 } })),
        ], sw - 0.4, 14);
        s.addText(ex.runs, { x: sx + 0.25, y, w: sw - 0.4, h: 1.3, fontSize: 14, valign: 'middle', lineSpacingMultiple: 1.25, ...tb });
      }
      note(s, sl.note, sx, Math.min(end + 0.1, 6.0), sw);
    } else if (sl.type === 'place') {
      // サイトでの表示場所：公開側の画面を左に、表示されるページ・位置・URL を右に並べる
      const P = await addShot(s, sl, 0.5, 1.3, 8.4, 5.6);
      (sl.marks || []).forEach((m, i) => mark(s, P.mark(m), i + 1, P.box));
      const items =[['表示されるページ', sl.pages], ['表示される位置', sl.position], [sl.urlLabel || 'URL', sl.urls]];
      let cy = 1.35;
      for (const [head, val] of items) {
        if (!val || (Array.isArray(val) && !val.length)) continue;
        const ls = Array.isArray(val) ? val : [val];
        s.addText(head, { x: 9.25, y: cy, w: 3.6, h: 0.4, fontSize: 15, bold: true, color: HEX.navy, valign: 'middle', ...tb });
        const h = 0.27 * ls.reduce((a, l) => a + lines(l, 3.6, 12), 0) + 0.1;
        s.addText(ls.map(l => fill(l, 3.6, 12)).join('\n'), { x: 9.25, y: cy + 0.45, w: 3.6, h, fontSize: 12, color: HEX.gray, valign: 'top', lineSpacingMultiple: 1.15, ...tb });
        cy += 0.45 + h + 0.4;
      }
      note(s, sl.note, 9.25, Math.min(cy, 6.0), 3.6);
    } else {
      throw new Error('未知のスライド type: ' + sl.type);
    }
  }
  const out = path.resolve(DIR, deck.output || 'manual.pptx');
  await pres.writeFile({ fileName: out });
  fs.writeFileSync(path.join(DIR, 'marks.json'), JSON.stringify(MARKS, null, 1));
  console.log('wrote', out, `(${CUR} slides)`, 'and marks.json');
}
build().catch(e => { console.error(e.message); process.exit(1); });
