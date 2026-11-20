// 公開側のページを開いて、マニュアルに使う配色・書体・角の丸さを読み取り、design.json に書き出す。
// ユーザーに確認せずに使う前提なので、読み取れなかった値は既定値のままにし、薄すぎる色は濃くしてから使う。
//   WPMV_LIB=<スキル>/scripts/lib.js SITE_JSON=site.json NODE_PATH=<node_modules> node site_design.js [design.json]
// 見るページは site.json の designPages（既定は ["/"]）。"/" で始まるものは base からの相対パス、http で始まるものはそのまま開く。
// ログインはしない（公開側だけを見る）。ロゴは読み取らない（ユーザーから受け取り、deck.json の logo に書く）。
// 最初に開けたページの画面を design_bg.png に保存する。build_deck.js が強くぼかして暗くし、表紙と章の扉の背景に使う（文字は読めなくなる）。
const fs = require('fs');
const path = require('path');
const L = require(process.env.WPMV_LIB || path.join(__dirname, 'lib.js'));

const site = L.loadSite();
const OUT = path.resolve(process.argv[2] || path.join(path.dirname(path.resolve(process.env.SITE_JSON || 'site.json')), 'design.json'));
const PAGES = (site.designPages && site.designPages.length ? site.designPages : ['/']).map(p => /^https?:/.test(p) ? p : site.base + p);

// ---- 色の計算
const hex = ([r, g, b]) => [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
const hsl = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
};
const lum = rgb => {
  const c = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// 白い背景で文字として読める濃さ（コントラスト比 4.5 以上）になるまで暗くする
const darkenFor = (rgb, ratio = 4.5) => {
  let c = rgb.slice();
  for (let i = 0; i < 40 && contrast(c, [255, 255, 255]) < ratio; i++) c = c.map(v => v * 0.94);
  return c;
};
const vivid = rgb => { const [, s, l] = hsl(rgb); return s >= 0.25 && l >= 0.15 && l <= 0.85; };

// 似た色をまとめ、重みの合計が大きい順に並べる
function group(list) {
  const groups = [];
  for (const { rgb, w } of list) {
    const g = groups.find(x => dist(x.rgb, rgb) < 28);
    if (g) { g.w += w; if (w > g.top) { g.top = w; g.rgb = rgb; } }
    else groups.push({ rgb, w, top: w });
  }
  return groups.sort((a, b) => b.w - a.w);
}

(async () => {
  const browser = await L.launch();
  const notes = [];
  const samples = [];
  const fonts = [];
  const radii = [];
  const vars = [];
  const BG = path.join(path.dirname(OUT), 'design_bg.png');
  let bgSaved = false;
  try {
    for (const url of PAGES) {
      const page = await L.newPage(browser);
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      } catch (e) {
        notes.push(`${url} を開けませんでした（${e.message.split('\n')[0]}）`);
        await page.close();
        continue;
      }
      await L.sleep(800);
      if (!bgSaved) { await page.screenshot({ path: BG }); bgSaved = true; }
      const r = await page.evaluate(() => {
        const parse = v => { const m = /rgba?\(([^)]+)\)/.exec(v || ''); if (!m) return null; const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return p.length >= 3 ? { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 } : null; };
        const visible = el => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return b.width > 4 && b.height > 4 && b.top < 3000 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.3; };
        const area = el => { const b = el.getBoundingClientRect(); return Math.min(b.width * b.height, 1440 * 200); };
        const out = { samples: [], fonts: [], radii: [], vars: [] };
        const add = (sel, kind, weight) => {
          document.querySelectorAll(sel).forEach(el => {
            if (!visible(el)) return;
            const cs = getComputedStyle(el);
            if (kind === 'bg') { const c = parse(cs.backgroundColor); if (c && c.a > 0.6) out.samples.push({ rgb: c.rgb, w: weight * Math.sqrt(area(el)), role: sel }); }
            if (kind === 'text') { const c = parse(cs.color); const t = (el.textContent || '').trim().length; if (c && t) out.samples.push({ rgb: c.rgb, w: weight * Math.min(t, 80), role: sel, text: true }); }
          });
        };
        const BTN = 'button, input[type=submit], .wp-block-button__link, .wp-element-button, a[class*="btn"], a[class*="button"], [class*="btn-"], .more-link';
        const HEAD = 'header, .site-header, #masthead, .l-header, [class*="header"]:not(html):not(body)';
        add(BTN, 'bg', 3);
        add(HEAD, 'bg', 2);
        add('footer, .site-footer, #colophon, [class*="footer"]:not(html):not(body)', 'bg', 1.5);
        add('h1, h2, h3', 'text', 2);
        add('nav a, .menu a, a', 'text', 1);
        add('[class*="title"], [class*="heading"], [class*="label"], [class*="badge"], [class*="tag"]', 'bg', 1.5);
        // ブロックテーマやよく使われる名前の CSS 変数（メインの色として指定されているもの）
        const root = getComputedStyle(document.documentElement);
        ['--wp--preset--color--primary', '--wp--preset--color--accent', '--wp--preset--color--main', '--wp--preset--color--vivid-cyan-blue', '--color-primary', '--primary', '--primary-color', '--main-color', '--color-main', '--theme-color', '--accent-color']
          .forEach(n => { const v = root.getPropertyValue(n).trim(); if (v) out.vars.push([n, v]); });
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta && meta.content) out.vars.push(['meta theme-color', meta.content]);
        // 書体（見出しと本文）
        const h = document.querySelector('h1, h2, .entry-title, .site-title');
        out.fonts.push(['heading', getComputedStyle(h || document.body).fontFamily]);
        out.fonts.push(['body', getComputedStyle(document.body).fontFamily]);
        // 角の丸さ（ボタン）
        document.querySelectorAll(BTN).forEach(el => { if (visible(el)) out.radii.push(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0); });
        return out;
      });
      samples.push(...r.samples); fonts.push(...r.fonts); radii.push(...r.radii); vars.push(...r.vars);
      await page.close();
    }
  } finally {
    await browser.close();
  }

  // CSS 変数の色を rgb にする（#rgb / #rrggbb / rgb() だけ扱う）
  const toRgb = v => {
    let m = /^#([0-9a-f]{3})$/i.exec(v); if (m) return m[1].split('').map(c => parseInt(c + c, 16));
    m = /^#([0-9a-f]{6})/i.exec(v); if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
    m = /rgba?\(([^)]+)\)/.exec(v); if (m) return m[1].split(/[\s,\/]+/).slice(0, 3).map(Number);
    return null;
  };
  const varColors = vars.map(([n, v]) => ({ n, rgb: toRgb(v) })).filter(x => x.rgb && vivid(x.rgb));

  // メインの色：くすんでいない色の中で重みが最大のもの。CSS 変数で指定されている色は重みを足す
  const vividList = samples.filter(s => vivid(s.rgb));
  varColors.forEach(v => vividList.push({ rgb: v.rgb, w: 400 }));
  const G = group(vividList);
  const design = { source: PAGES, notes };
  if (bgSaved) design.bg = path.basename(BG);
  let primary = null;
  if (G.length) {
    primary = G[0].rgb;
    design.primaryRaw = hex(primary);
  } else {
    notes.push('メインの色を読み取れなかったので、既定の配色を使います');
  }

  // 濃い色：表紙・扉の背景とタイトルの文字。暗い背景・見出しの文字から選び、無ければメインの色を暗くする
  const darkList = samples.filter(s => { const [, , l] = hsl(s.rgb); return l < 0.3 && !(s.rgb[0] < 20 && s.rgb[1] < 20 && s.rgb[2] < 20 && s.text); });
  const D = group(darkList);
  let dark = D.length ? D[0].rgb : null;
  if (!dark && primary) dark = darkenFor(primary, 12);
  if (dark && contrast(dark, [255, 255, 255]) < 10) dark = darkenFor(dark, 10);

  if (primary) {
    const adj = darkenFor(primary);
    if (hex(adj) !== hex(primary)) notes.push(`メインの色 #${hex(primary)} は白い背景で文字が読みにくいので、#${hex(adj)} に濃くして使います`);
    design.primary = hex(adj);
    // クリック場所の目印は赤。メインの色が赤系なら埋もれるので青にする
    const [h, s] = hsl(primary);
    if (s > 0.35 && (h <= 25 || h >= 335)) { design.mark = '1F6FEB'; notes.push('メインの色が赤系なので、クリック場所の目印を青にします'); }
  }
  if (dark) design.dark = hex(dark);

  // 書体：ゴシック系か明朝系かだけを見て、Windows と Mac の PowerPoint にある書体に置き換える
  const head = (fonts.find(f => f[0] === 'heading') || [])[1] || '';
  const serif = /mincho|明朝|serif/i.test(head) && !/sans-serif\s*$/i.test(head.split(',')[0]) && !/sans/i.test(head.split(',')[0]);
  design.fontKind = serif ? 'mincho' : 'gothic';
  design.font = serif ? 'Yu Mincho' : 'Meiryo';
  design.fontSeen = head;

  // 角の丸さ：ボタンの角の丸さの中央値（px）をスライドの角丸（インチ）に置き換える
  if (radii.length) {
    const s = radii.slice().sort((a, b) => a - b), med = s[Math.floor(s.length / 2)];
    design.radiusPx = med;
    design.radius = med <= 1 ? 0 : med <= 6 ? 0.04 : med <= 14 ? 0.08 : 0.14;
  } else {
    notes.push('ボタンが見つからず角の丸さを読み取れなかったので、少しだけ丸めます');
    design.radius = 0.04;
  }

  fs.writeFileSync(OUT, JSON.stringify(design, null, 1));
  console.log('wrote', OUT);
  console.log(JSON.stringify(design, null, 1));
})().catch(e => { console.error(e.message); process.exit(1); });
