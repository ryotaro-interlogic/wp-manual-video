// 日本語の文章を、文節の切れ目と禁則（行頭に「、」「。」などを置かない）を守って、枠の幅で改行する。
// PowerPoint に折り返しを任せると「見／かた」のように単語の途中で切れるので、改行をこちらで入れる。
//   const W = require('./jwrap'); W.wrap('ログインと画面の見かた', 2.2, 17, { bold: true }) → ['ログインと画面の', '見かた']
// 文字の幅は推定（全角 1em、半角はおよそ 0.55em）。推定がずれても PowerPoint 側で再び折り返されないよう、枠より少し狭く組む。
const { loadDefaultJapaneseParser } = require('budoux');

const parser = loadDefaultJapaneseParser();
const SAFE = 0.93; // 枠の幅に対して使う割合
// 行頭に置かない文字・行末に置かない文字
const NO_START = '、。，．,.・：；:;？！?!ー‐－～」』）)］]｝}〉》】〕’”ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々〻%％';
const NO_END = '「『（(［[｛{〈《【〔‘“';

// 1文字の幅（em）
function charW(ch) {
  const c = ch.codePointAt(0);
  if (c >= 0xff61 && c <= 0xff9f) return 0.5; // 半角カナ
  if (c >= 0x80) return 1;
  if (ch === ' ') return 0.32;
  if (/[A-Z0-9#%&@MW]/.test(ch)) return 0.64;
  if (/[a-z]/.test(ch)) return 0.56;
  return 0.42; // 記号
}
const textW = (s, bold) => [...s].reduce((a, ch) => a + charW(ch), 0) * (bold ? 1.04 : 1);

// 文節に分ける。英数字の長い並び（URL など）は / . - _ スペースの後でも切れるようにする
function segments(para) {
  const out = [];
  for (const seg of parser.parse(para)) {
    // 「動画・資料・テストフォームを」のような長い文節は、中黒の後でも切れるようにする
    // スペースの後、中黒の後でも切れるようにする（BudouX はスペースで区切らないことがある）
    for (const part of seg.split(/(?<=[・ 　])/)) {
      if (/[A-Za-z0-9]{12,}|https?:\/\//.test(part)) out.push(...part.split(/(?<=[\/\.\-_ ])/));
      else out.push(part);
    }
  }
  return out;
}

// 1つの文節が1行に入らないときは、禁則を守って文字単位で分ける
function breakLong(seg, max, bold) {
  const lines = [];
  let cur = '';
  for (const ch of seg) {
    if (cur && textW(cur + ch, bold) > max && !NO_START.includes(ch)) { lines.push(cur); cur = ''; }
    cur += ch;
  }
  if (cur) lines.push(cur);
  // 最後の行が1〜2文字だけにならないよう、前の行から文字を送る
  const last = lines.length - 1;
  if (last > 0 && [...lines[last]].length <= 2) {
    const prev = [...lines[last - 1]];
    const move = Math.min(3 - [...lines[last]].length, prev.length - 1);
    lines[last] = prev.splice(prev.length - move).join('') + lines[last];
    lines[last - 1] = prev.join('');
  }
  return lines;
}

// 行頭に来てしまった禁則文字を、前の行の最後の1文字と一緒に次の行へ送る（追い出し）。
// 行末に来てしまった開き括弧も次の行へ送る
function kinsoku(lines) {
  for (let i = 1; i < lines.length; i++) {
    let guard = 0;
    while (lines[i] && NO_START.includes(lines[i][0]) && lines[i - 1].length > 1 && guard++ < 3) {
      const prev = [...lines[i - 1]];
      lines[i] = prev.pop() + lines[i];
      lines[i - 1] = prev.join('');
    }
  }
  for (let i = 0; i < lines.length - 1; i++) {
    const prev = [...lines[i]];
    while (prev.length > 1 && NO_END.includes(prev[prev.length - 1])) lines[i + 1] = prev.pop() + lines[i + 1];
    lines[i] = prev.join('');
  }
  return lines.filter(l => l !== '');
}

// text を幅 widthIn（インチ）、文字サイズ pt で折り返し、行の配列を返す。text 内の \n はそのまま改行にする
function wrap(text, widthIn, pt, { bold = false } = {}) {
  const max = (widthIn * 72 * SAFE) / pt; // 1行に入る幅（em）
  const result = [];
  for (const para of String(text).split('\n')) {
    if (!para) { result.push(''); continue; }
    const lines = [];
    let cur = '';
    for (const seg of segments(para)) {
      if (textW(cur + seg, bold) <= max) { cur += seg; continue; }
      if (cur) { lines.push(cur); cur = ''; }
      if (textW(seg, bold) <= max) { cur = seg; continue; }
      const parts = breakLong(seg, max, bold);
      cur = parts.pop();
      lines.push(...parts);
    }
    if (cur) lines.push(cur);
    result.push(...kinsoku(lines));
  }
  return result;
}

// 改行を入れた文字列を返す
const fill = (text, widthIn, pt, opts) => wrap(text, widthIn, pt, opts).join('\n');
const count = (text, widthIn, pt, opts) => Math.max(1, wrap(text, widthIn, pt, opts).length);

// 文字の飾りが違う部分（runs）が混ざった文章を折り返す。
// runs は pptxgenjs の [{ text, options }]。options.breakLine は段落の区切りとして扱う。
// 戻り値は改行位置に breakLine を入れた runs と、行数
function wrapRuns(runs, widthIn, pt) {
  const bold = runs.some(r => r.options && r.options.bold);
  const plain = runs.map(r => r.text + (r.options && r.options.breakLine ? '\n' : '')).join('');
  const lines = wrap(plain.replace(/\n$/, ''), widthIn, pt, { bold });
  // 各行の文字数に合わせて、元の runs を切り分ける
  const flat = [];
  runs.forEach(r => { for (const ch of r.text) flat.push({ ch, o: r.options || {} }); if (r.options && r.options.breakLine) flat.push({ ch: '\n', o: r.options }); });
  const out = [];
  let k = 0;
  lines.forEach((line, li) => {
    let piece = null;
    for (const ch of line) {
      while (k < flat.length && flat[k].ch === '\n') k++;
      const f = flat[k++];
      const o = { ...f.o }; delete o.breakLine;
      if (piece && JSON.stringify(piece.o) === JSON.stringify(o)) piece.text += ch;
      else { if (piece) out.push({ text: piece.text, options: piece.o }); piece = { text: ch, o }; }
    }
    if (piece) out.push({ text: piece.text, options: { ...piece.o, breakLine: li < lines.length - 1 } });
    else if (li < lines.length - 1) out.push({ text: '', options: { breakLine: true } });
    // 行の区切りで消えた空白を読み飛ばす
    while (k < flat.length && (flat[k].ch === '\n')) k++;
  });
  return { runs: out, lines: Math.max(1, lines.length) };
}

module.exports = { wrap, fill, count, wrapRuns, textW };
