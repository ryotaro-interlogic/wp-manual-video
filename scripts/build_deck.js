// deck.json（スライドの設計図）から操作マニュアルの pptx を作り、動画用に赤枠の位置を marks.json に書き出す。
//   NODE_PATH=<node_modules> node build_deck.js path/to/deck.json
// 書式は references/deck-spec.md を参照。
const fs = require('fs');
const path = require('path');
const pptxgen = require('pptxgenjs');
const sharp = require('sharp');

const deckFile = path.resolve(process.argv[2] || 'deck.json');
const DIR = path.dirname(deckFile);
const deck = JSON.parse(fs.readFileSync(deckFile, 'utf8'));
const SHOTS = path.resolve(DIR, deck.shotsDir || 'shots');
const RECT = fs.existsSync(path.resolve(DIR, deck.rects || 'rects.json')) ? JSON.parse(fs.readFileSync(path.resolve(DIR, deck.rects || 'rects.json'), 'utf8')) : {};
const SRC_W = 1440; // 撮影時の画面幅（論理ピクセル）

const HEX = Object.assign({ orange: 'E2652B', red: 'D92D20', navy: '1E2A44', gray: '5B6472', light: 'F2F4F7', peach: 'FCE9DD', warn: 'FDECEA', text: '3A4250', sub: 'C9D1DE', subtitle: 'F8C9AE' }, deck.colors || {});
const FONT = deck.font || 'Meiryo';

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5
pres.title = deck.title;
if (deck.author) pres.author = deck.author;
pres.theme = { headFontFace: FONT, bodyFontFace: FONT };

pres.defineSlideMaster({ title: 'TITLE', background: { color: HEX.navy }, objects: [
  { placeholder: { options: { name: 'title', type: 'title', x: 0.8, y: 2.2, w: 11.7, h: 1.4, fontSize: 40, bold: true, color: 'FFFFFF', valign: 'bottom', align: 'left', margin: 0 }, text: '' } },
  { placeholder: { options: { name: 'body', type: 'body', x: 0.8, y: 3.8, w: 11.7, h: 1.2, fontSize: 18, color: HEX.subtitle, valign: 'top', align: 'left', margin: 0 }, text: '' } },
] });
pres.defineSlideMaster({ title: 'SECTION', background: { color: HEX.navy }, objects: [
  { placeholder: { options: { name: 'title', type: 'title', x: 2.6, y: 2.75, w: 10, h: 1.1, fontSize: 36, bold: true, color: 'FFFFFF', valign: 'middle', align: 'left', margin: 0 }, text: '' } },
  { placeholder: { options: { name: 'body', type: 'body', x: 2.6, y: 3.85, w: 10, h: 0.9, fontSize: 16, color: HEX.sub, valign: 'top', align: 'left', margin: 0 }, text: '' } },
] });
pres.defineSlideMaster({ title: 'CONTENT', background: { color: 'FFFFFF' }, objects: [
  { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.3, w: 12.3, h: 0.75, fontSize: 28, bold: true, color: HEX.navy, valign: 'middle', align: 'left', margin: 0 }, text: '' } },
], slideNumber: { x: 12.3, y: 7.0, w: 0.6, h: 0.3, fontSize: 10, color: '8A93A3', align: 'right' } });

// ---- 部品
let CUR = 0;
const MARKS = [];
const tb = { margin: 0, isTextBox: true };
// 日本語 1 文字の幅（インチ）からおおよその行数を出す
const lines = (text, w, pt) => Math.max(1, Math.ceil(String(text).length * pt * 0.0145 / w));

function badge(s, x, y, n, d = 0.42, color = HEX.orange) {
  s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color }, line: { color: 'FFFFFF', width: 1.5 } });
  s.addText(String(n), { x, y, w: d, h: d, fontSize: d >= 0.6 ? 18 : d > 0.4 ? 16 : 13, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', ...tb });
}
function mark(s, r, n) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { ...r, rectRadius: 0.05, fill: { type: 'none' }, line: { color: HEX.red, width: 2.5 } });
  badge(s, r.x - 0.17, r.y - 0.17, n, 0.34, HEX.red);
  MARKS.push({ slide: CUR, n, x: r.x, y: r.y, w: r.w, h: r.h });
}
function note(s, n, x, y, w, h) {
  if (!n) return y;
  const warn = n.kind === 'warn';
  h = h || 0.3 + 0.24 * lines(n.text, w - 0.36, 12);
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.08, fill: { color: warn ? HEX.warn : HEX.peach }, line: { color: warn ? HEX.warn : HEX.peach } });
  s.addText([
    { text: (warn ? '注意' : 'ポイント') + '　', options: { bold: true, color: warn ? HEX.red : HEX.orange } },
    { text: n.text, options: { color: HEX.text } },
  ], { x: x + 0.18, y, w: w - 0.36, h, fontSize: 12, valign: 'middle', lineSpacingMultiple: 1.15, ...tb });
  return y + h;
}
function steps(s, items, x, y, w) {
  let cy = y;
  items.forEach(([head, body], i) => {
    badge(s, x, cy, i + 1, 0.42, HEX.red);
    s.addText(head, { x: x + 0.55, y: cy - 0.02, w: w - 0.55, h: 0.46, fontSize: 15, bold: true, color: HEX.navy, valign: 'middle', ...tb });
    const bh = body ? 0.27 * lines(body, w - 0.55, 12) + 0.12 : 0;
    if (body) s.addText(body, { x: x + 0.55, y: cy + 0.46, w: w - 0.55, h: bh, fontSize: 12, color: HEX.gray, valign: 'top', lineSpacingMultiple: 1.15, ...tb });
    cy += 0.62 + bh + 0.2;
  });
  return cy;
}
function cards(s, items, y, h, big) {
  const n = items.length, gap = 0.24, w = (12.3 - gap * (n - 1)) / n;
  items.forEach(([head, body], i) => {
    const x = 0.5 + i * (w + gap);
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.1, fill: { color: HEX.light }, line: { color: HEX.light } });
    if (big) {
      badge(s, x + 0.3, y + 0.3, i + 1, 0.7);
      s.addText(head, { x: x + 0.3, y: y + 1.25, w: w - 0.6, h: 0.9, fontSize: 17, bold: true, color: HEX.navy, valign: 'top', ...tb });
      s.addText(body || '', { x: x + 0.3, y: y + 2.2, w: w - 0.6, h: h - 2.4, fontSize: 13, color: HEX.gray, valign: 'top', lineSpacingMultiple: 1.2, ...tb });
    } else {
      badge(s, x + 0.25, y + 0.25, i + 1, 0.5, HEX.red);
      s.addText(head, { x: x + 0.9, y: y + 0.25, w: w - 1.1, h: 0.5, fontSize: 16, bold: true, color: HEX.navy, valign: 'middle', ...tb });
      s.addText(body || '', { x: x + 0.25, y: y + 0.9, w: w - 0.5, h: h - 1.05, fontSize: 13, color: HEX.gray, valign: 'top', lineSpacingMultiple: 1.2, ...tb });
    }
  });
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
  let section = 'はじめに';
  pres.addSection({ title: section });
  for (const sl of deck.slides) {
    if (sl.type === 'section') { section = sl.section || sl.title; pres.addSection({ title: section }); }
    const master = sl.type === 'cover' ? 'TITLE' : sl.type === 'section' ? 'SECTION' : 'CONTENT';
    const s = pres.addSlide({ masterName: master, sectionTitle: section });
    CUR++;
    if (sl.type === 'cover') {
      s.addText(deck.title, { placeholder: 'title' });
      s.addText(deck.subtitle || '', { placeholder: 'body' });
      if (deck.footnote) s.addText(deck.footnote, { x: 0.8, y: 6.3, w: 9, h: 0.4, fontSize: 13, color: HEX.sub, ...tb });
      continue;
    }
    if (sl.type === 'section') {
      s.addShape(pres.shapes.OVAL, { x: 0.8, y: 2.75, w: 1.4, h: 1.4, fill: { color: HEX.orange }, line: { color: HEX.orange } });
      s.addText(String(sl.no), { x: 0.8, y: 2.75, w: 1.4, h: 1.4, fontSize: 44, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', ...tb });
      s.addText(sl.title, { placeholder: 'title' });
      s.addText(sl.sub || '', { placeholder: 'body' });
      continue;
    }
    s.addText(sl.title, { placeholder: 'title' });
    // タイトルの下に「この編集機能があるページ：〇〇」を小さく出す
    if (sl.where) s.addText('この編集機能があるページ：' + sl.where, { x: 0.5, y: 1.0, w: 12.3, h: 0.28, fontSize: 11, color: HEX.gray, valign: 'middle', ...tb });
    if (sl.type === 'flow') {
      cards(s, sl.cards, 1.6, 3.6, true);
      note(s, sl.note, 0.5, 5.7, 12.3);
    } else if (sl.type === 'cards') {
      cards(s, sl.cards, 1.5, 3.2, true);
      note(s, sl.note, 0.5, 5.2, 12.3);
    } else if (sl.type === 'table') {
      const hdr = t => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: HEX.navy } } });
      const cols = sl.header.length;
      const rows = sl.rows.map(r => r.map((c, i) => ({ text: c, options: i % 2 === 0 ? { bold: true, color: HEX.navy, fill: { color: HEX.light } } : { color: HEX.text } })));
      const colW = cols === 4 ? [2.2, 3.95, 2.2, 3.95] : Array(cols).fill(12.3 / cols);
      s.addTable([sl.header.map(hdr), ...rows], { x: 0.5, y: 1.4, w: 12.3, colW, rowH: 0.62, fontSize: 14, valign: 'middle', border: { type: 'solid', pt: 1, color: 'D0D5DD' }, margin: [0, 0.15, 0, 0.15] });
      note(s, sl.note, 0.5, 1.4 + 0.62 * (rows.length + 1) + 0.35, 12.3);
    } else if (sl.type === 'banner') {
      await addShot(s, sl.shot, 0.5, 1.3, 12.3);
      cards(s, sl.cards, 4.2, 1.9, false);
      note(s, sl.note, 0.5, 6.35, 12.3, 0.5);
    } else if (sl.type === 'pair') {
      let n = 0;
      for (const [i, sp] of sl.shots.entries()) {
        const P = await addShot(s, sp, 0.5 + i * 6.3, 1.3, 6.0);
        for (const m of sp.marks || []) mark(s, P.mark(m), ++n);
      }
      sl.steps.forEach(([head, body], i) => {
        const x = 0.5 + i * (12.3 / sl.steps.length);
        badge(s, x, 5.3, i + 1, 0.42, HEX.red);
        s.addText(head, { x: x + 0.55, y: 5.28, w: 3.5, h: 0.46, fontSize: 15, bold: true, color: HEX.navy, valign: 'middle', ...tb });
        if (body) s.addText(body, { x: x + 0.55, y: 5.78, w: 3.5, h: 0.7, fontSize: 12, color: HEX.gray, valign: 'top', lineSpacingMultiple: 1.15, ...tb });
      });
      note(s, sl.note, 0.5, 6.55, 12.3, 0.5);
    } else if (sl.type === 'shot') {
      // 縦長に切り抜いた画面は高さ優先で置き、右側を広く使う
      const tall = sl.crop && sl.crop[3] > sl.crop[2] * 0.9;
      const P = tall ? await addShot(s, sl, 0.9, 1.3, 10, 5.4) : await addShot(s, sl, 0.5, 1.3, 8.4);
      (sl.marks || []).forEach((m, i) => mark(s, P.mark(m), i + 1));
      const sx = tall ? P.box.x + P.box.w + 0.7 : 9.25;
      const sw = 12.85 - sx;
      const end = steps(s, sl.steps || [], sx, tall ? 1.3 : 1.35, sw);
      if (sl.extra) {
        const y = Math.max(end, 5.4);
        s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: sx, y, w: sw, h: 1.3, rectRadius: 0.08, fill: { color: HEX.light }, line: { color: HEX.light } });
        s.addText([
          { text: sl.extra.head, options: { bold: true, color: HEX.navy, breakLine: true } },
          ...sl.extra.lines.map((l, i) => ({ text: l, options: { color: i === sl.extra.lines.length - 1 && sl.extra.accentLast ? HEX.orange : HEX.gray, bold: i === sl.extra.lines.length - 1 && sl.extra.accentLast, breakLine: i < sl.extra.lines.length - 1 } })),
        ], { x: sx + 0.25, y, w: sw - 0.4, h: 1.3, fontSize: 14, valign: 'middle', lineSpacingMultiple: 1.25, ...tb });
      }
      note(s, sl.note, sx, Math.min(end + 0.1, 6.0), sw);
    } else if (sl.type === 'place') {
      // サイトでの表示場所：公開側の画面を左に、表示されるページ・位置・URL を右に並べる
      const P = await addShot(s, sl, 0.5, 1.3, 8.4, 5.6);
      (sl.marks || []).forEach((m, i) => mark(s, P.mark(m), i + 1));
      const items = [['表示されるページ', sl.pages], ['表示される位置', sl.position], [sl.urlLabel || 'URL', sl.urls]];
      let cy = 1.35;
      for (const [head, val] of items) {
        if (!val || (Array.isArray(val) && !val.length)) continue;
        const ls = Array.isArray(val) ? val : [val];
        s.addText(head, { x: 9.25, y: cy, w: 3.6, h: 0.4, fontSize: 15, bold: true, color: HEX.navy, valign: 'middle', ...tb });
        const h = 0.27 * ls.reduce((a, l) => a + lines(l, 3.6, 12), 0) + 0.1;
        s.addText(ls.join('\n'), { x: 9.25, y: cy + 0.45, w: 3.6, h, fontSize: 12, color: HEX.gray, valign: 'top', lineSpacingMultiple: 1.15, ...tb });
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
