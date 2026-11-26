// 管理画面の撮影に使う共通処理：ログイン、会社名などのぼかし・置き換え、撮影、部品の位置の記録。
// site.json（サイトごとの設定）を読み込んで使う。書式は SKILL.md の「site.json」を参照。
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadSite(file = process.env.SITE_JSON || 'site.json') {
  const site = JSON.parse(fs.readFileSync(file, 'utf8'));
  site.shotsDir = path.resolve(path.dirname(file), site.shotsDir || 'shots');
  fs.mkdirSync(site.shotsDir, { recursive: true });
  return site;
}

// ログイン情報は site.json に直接書かず、別ファイル（credFile）か環境変数から読む
function loadCred(site, role = 'editor') {
  if (process.env.WP_USER && process.env.WP_PASS) return { user: process.env.WP_USER, pass: process.env.WP_PASS };
  const c = JSON.parse(fs.readFileSync(path.resolve(site.credFile), 'utf8'));
  return c[role] || c;
}

// 画面上だけで会社名などを隠す（保存はしない）
async function mask(page, site) {
  const m = site.mask || {};
  await page.evaluate((m) => {
    const blur = 'filter: blur(7px) !important;';
    let st = document.getElementById('__mask');
    if (!st) { st = document.createElement('style'); st.id = '__mask'; document.head.appendChild(st); }
    const sels = ['#wp-admin-bar-site-name > a', '#wp-admin-bar-my-account > a', '#backtoblog', '.column-author', 'td.author', ...(m.blurSelectors || [])];
    st.textContent = sels.join(',') + `{${blur}}`;
    const reps = (m.replace || []).map(([re, to]) => [new RegExp(re, 'g'), to]);
    const rep = v => reps.reduce((s, [re, to]) => s.replace(re, to), v);
    const words = m.blurWords || [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const v = rep(n.textContent);
      if (v !== n.textContent) n.textContent = v;
      if (words.some(w => n.textContent.includes(w)) && n.parentElement) n.parentElement.style.filter = 'blur(7px)';
    }
    document.querySelectorAll('input[type=text],input:not([type]),input[type=email],textarea').forEach(el => {
      const v = rep(el.value || ''); if (v !== el.value) el.value = v;
    });
    document.querySelectorAll('[placeholder]').forEach(el => {
      const v = rep(el.getAttribute('placeholder')); if (v !== el.getAttribute('placeholder')) el.setAttribute('placeholder', v);
    });
  }, m);
}

async function shot(page, site, name, opts = {}) {
  await mask(page, site);
  await sleep(300);
  await page.screenshot({ path: path.join(site.shotsDir, name + '.png'), ...opts });
  console.log('shot', name);
}

// 赤枠を付ける部品の位置（画面座標）を記録する。
// targets は { 名前: 'ブラウザ内で要素を返す式' }。'F:' で始まる式はブロックエディタの iframe 内を探す。
const RECTS = {};
async function rects(page, name, targets) {
  RECTS[name] = await page.evaluate((t) => {
    const ifr = document.querySelector('iframe[name=editor-canvas]');
    const idoc = ifr ? ifr.contentDocument : null;
    const off = ifr ? ifr.getBoundingClientRect() : { x: 0, y: 0 };
    const out = {};
    for (const [k, e] of Object.entries(t)) {
      const inFrame = e.startsWith('F:');
      let el = null;
      try { el = inFrame ? (idoc ? (new Function('document', 'return ' + e.slice(2)))(idoc) : null) : eval(e); } catch (_) { el = null; }
      if (!el) { out[k] = null; continue; }
      const r = el.getBoundingClientRect();
      out[k] = [r.x + (inFrame ? off.x : 0), r.y + (inFrame ? off.y : 0), r.width, r.height];
    }
    return out;
  }, targets);
  const missing = Object.entries(RECTS[name]).filter(([, v]) => !v).map(([k]) => k);
  console.log('rects', name, missing.length ? 'missing: ' + missing.join(',') : 'ok');
}
function saveRects(site, file = 'rects.json') {
  const p = path.resolve(path.dirname(site.shotsDir), file);
  const old = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  fs.writeFileSync(p, JSON.stringify({ ...old, ...RECTS }, null, 1));
  console.log('saved', p);
}

async function launch() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--lang=ja-JP'] });
  return browser;
}
async function newPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  page.on('dialog', d => d.accept());
  return page;
}

// ログインして管理画面のページを返す。loginShot を渡すと、ログイン前の画面も撮る。
async function login(site, { role = 'editor', loginShot } = {}) {
  const browser = await launch();
  const page = await newPage(browser);
  await page.goto(site.base + '/wp-login.php', { waitUntil: 'networkidle2' });
  if (loginShot) {
    await shot(page, site, loginShot);
    await rects(page, loginShot, {
      user: `document.querySelector('#user_login')`,
      pass: `document.querySelector('#user_pass').closest('.wp-pwd') || document.querySelector('#user_pass')`,
      submit: `document.querySelector('#wp-submit')`,
      box: `document.querySelector('#login')`,
    });
  }
  const cred = loadCred(site, role);
  await page.type('#user_login', cred.user);
  await page.type('#user_pass', cred.pass);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click('#wp-submit')]);
  if (page.url().includes('wp-login.php')) throw new Error('ログインできませんでした（画像認証やログインURL変更の可能性）');
  return { browser, page };
}

// 公開側のページを撮る前の準備。スクロールで出てくる演出を止めて全部表示し、遅延読み込みの画像を読み込ませる。
// hide: 演出で最初は消えている要素のセレクタ（サイトに合わせて足す）
async function prepFront(page, { hide = ['.reveal', '.reveal-left', '.reveal-right', '.fade-in', '.js-fade', '[data-aos]', '[class*="delay-"]'] } = {}) {
  await page.addStyleTag({ content: hide.join(',') + '{opacity:1!important;transform:none!important;transition:none!important;animation:none!important;visibility:visible!important}' });
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 80)); }
    window.scrollTo(0, 0);
  });
  await sleep(1200);
}

// 公開側のページの一部を撮り、部品の位置を記録する（compare / place スライド用）。
// anchor の要素が画面の上から offset の位置に来るようにスクロールする（固定ヘッダーに隠れないよう offset はヘッダーの高さ＋余白）。
// height で画面の高さを変えられる（縦に長い部分を1枚に収める）。targets は { 名前: CSSセレクタ }。
async function siteShot(page, site, name, { anchor, offset = 90, height = 900, targets = {}, mask: doMask = false } = {}) {
  await page.setViewport({ width: 1440, height, deviceScaleFactor: 2 });
  if (anchor) {
    const ok = await page.evaluate((a, o) => { const e = document.querySelector(a); if (!e) return false; window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - o); return true; }, anchor, offset);
    if (!ok) console.log('siteShot', name, 'anchor missing:', anchor);
  }
  await sleep(900);
  if (doMask) await mask(page, site);
  await page.screenshot({ path: path.join(site.shotsDir, name + '.png') });
  console.log('shot', name);
  await rects(page, name, Object.fromEntries(Object.entries(targets).map(([k, v]) => [k, `document.querySelector(${JSON.stringify(v)})`])));
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
}

// 投稿の保存・自動保存の通信を止める（新規投稿画面を撮るとき用）
async function blockSaves(page, postType = 'posts') {
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url(), m = req.method();
    const save = m !== 'GET' && (new RegExp(`/wp/v2/${postType}`).test(u) || /autosaves/.test(u) || /post\.php/.test(u) ||
      (/admin-ajax\.php/.test(u) && /heartbeat/.test(req.postData() || '')));
    if (save) { console.log('blocked', m, u.slice(0, 100)); return req.abort(); }
    req.continue();
  });
}

module.exports = { sleep, loadSite, login, launch, newPage, mask, shot, rects, saveRects, blockSaves, prepFront, siteShot };
