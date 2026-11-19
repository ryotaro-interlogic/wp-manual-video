// 見本：WPForms で新しいフォームを作り、自動返信を設定し、カスタム投稿に入れるまでを撮影する。
//   WPMV_LIB=<スキルのフォルダ>/scripts/lib.js SITE_JSON=site.json NODE_PATH=... node capture.js
// 本番サイトにテスト用フォーム（site.testForm）を1つ作る。フォームの保存は「フォーム名だけ」で、
// 項目追加・通知設定・投稿は保存しない。撮影後、テスト用フォームの削除をユーザーに依頼すること
// （編集者アカウントには WPForms の削除権限がないことが多い）。
const fs = require('fs');
const L = require(process.env.WPMV_LIB || require('path').join(require('os').homedir(), '.claude/skills/wp-manual-video/scripts/lib.js'));
const site = L.loadSite();
const BASE = site.base;
const block = name => `[...document.querySelectorAll('.wpforms-notification')].find(x => x.querySelector('.wpforms-builder-settings-block-name').textContent.includes(${JSON.stringify(name)}))`;
const row = (blk, label) => `[...${blk}.querySelectorAll('.wpforms-panel-field')].find(r => r.querySelector('label') && r.querySelector('label').textContent.includes(${JSON.stringify(label)}))`;

(async () => {
  const { browser, page } = await L.login(site, { loginShot: '01_login' });
  try {
    // フォーム一覧
    await page.goto(BASE + '/wp-admin/admin.php?page=wpforms-overview', { waitUntil: 'networkidle2' });
    await L.shot(page, site, 'n01_forms');
    await L.rects(page, 'n01_forms', { menu: `document.querySelector('#toplevel_page_wpforms-overview > a')`, add: `document.querySelector('.page-title-action, .add-new-h2')` });

    // フォーム名とテンプレート（ここで一時フォームが作られる）
    await page.goto(BASE + '/wp-admin/admin.php?page=wpforms-builder&view=setup', { waitUntil: 'networkidle2' });
    await L.sleep(2500);
    await page.type('#wpforms-setup-name', site.testForm);
    await page.hover('#wpforms-template-blank');
    await L.sleep(800);
    await L.shot(page, site, 'n02_setup');
    await L.rects(page, 'n02_setup', { name: `document.querySelector('#wpforms-setup-name')`, button: `document.querySelector('#wpforms-template-blank .wpforms-template-select')` });
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }), page.click('#wpforms-template-blank .wpforms-template-select')]);
    await L.sleep(2500);
    const formId = new URL(page.url()).searchParams.get('form_id');
    fs.writeFileSync('temp_form_id.txt', String(formId));
    console.log('一時フォームを作成:', formId);
    await L.shot(page, site, 'n03_blank');

    // 項目を追加
    for (const t of ['name', 'email', 'phone', 'textarea']) { await page.click('#wpforms-add-fields-' + t); await L.sleep(1500); }
    await L.shot(page, site, 'n04_added');
    await L.rects(page, 'n04_added', { name: `document.querySelector('#wpforms-add-fields-name')`, email: `document.querySelector('#wpforms-add-fields-email')`, phone: `document.querySelector('#wpforms-add-fields-phone')`, textarea: `document.querySelector('#wpforms-add-fields-textarea')` });

    // ラベルと必須
    const tid = await page.evaluate(() => [...document.querySelectorAll('.wpforms-field-wrap .wpforms-field')].find(f => f.dataset.fieldType === 'textarea').dataset.fieldId);
    await page.click(`.wpforms-field-wrap .wpforms-field[data-field-id="${tid}"]`);
    await L.sleep(1200);
    await page.$eval(`#wpforms-field-option-${tid}-label`, el => { el.value = ''; });
    await page.type(`#wpforms-field-option-${tid}-label`, 'お問い合わせ内容');
    await page.$eval(`#wpforms-field-option-${tid}-required`, el => { if (!el.checked) el.click(); });
    await L.sleep(1000);
    await L.shot(page, site, 'n05_options');
    await L.rects(page, 'n05_options', { label: `document.querySelector('#wpforms-field-option-row-${tid}-label')`, required: `document.querySelector('#wpforms-field-option-row-${tid}-required')`, field: `document.querySelector('.wpforms-field-wrap .wpforms-field[data-field-id="${tid}"]')` });

    // 設定 > 通知
    await page.click('button[data-panel=settings]'); await L.sleep(1500);
    await page.click('.wpforms-panel-sidebar-section[data-section=notifications]'); await L.sleep(1500);
    await L.shot(page, site, 'n06_notifications');
    await L.rects(page, 'n06_notifications', { settings: `document.querySelector('button[data-panel=settings]')`, notif: `document.querySelector('.wpforms-panel-sidebar-section[data-section=notifications]')`, first: `document.querySelector('.wpforms-notification .wpforms-builder-settings-block-header')` });

    // 新規通知
    await page.click('.wpforms-notifications-add'); await L.sleep(1200);
    await page.type('.jconfirm-box input[type=text]', '自動返信メール');
    await L.shot(page, site, 'n07_modal');
    await L.rects(page, 'n07_modal', { add: `document.querySelector('.wpforms-notifications-add')`, input: `document.querySelector('.jconfirm-box input[type=text]')`, ok: `document.querySelector('.jconfirm-box .jconfirm-buttons button')` });
    await page.click('.jconfirm-box .jconfirm-buttons button:first-child'); await L.sleep(2000);
    const B = block('自動返信メール');
    const to = row(B, '送信先メールアドレス');

    // 送信先：管理者のアドレスを消して、メールアドレス項目を選ぶ
    await page.evaluate(r => eval(r).scrollIntoView({ block: 'center' }), to); await L.sleep(600);
    await L.shot(page, site, 'n08a_before');
    await L.rects(page, 'n08a_before', { field: `${to}.querySelector('.wpforms-smart-tags-widget-container')` });
    await page.evaluate(r => eval(r).querySelector('span.tag[data-value=admin_email] i').click(), to); await L.sleep(600);
    await page.evaluate(r => eval(r).querySelector('.wpforms-show-smart-tags').click(), to); await L.sleep(1200);
    await L.shot(page, site, 'n08_smarttag');
    await L.rects(page, 'n08_smarttag', { tag: `${to}.querySelector('.wpforms-show-smart-tags')`, item: `[...${to}.querySelectorAll('li')].find(li => li.textContent.trim() === 'メールアドレス')` });
    await page.evaluate(r => [...eval(r).querySelectorAll('li')].find(li => li.textContent.trim() === 'メールアドレス').querySelector('span').click(), to); await L.sleep(800);

    // 件名・本文（スマートタグ欄は contenteditable の div）
    await page.evaluate(r => eval(r).querySelector('[contenteditable=true]').focus(), row(B, 'メール件名'));
    await page.keyboard.type('【〇〇〇〇】お問い合わせありがとうございます');
    await page.evaluate(r => { const e = eval(r).querySelector('[contenteditable=true]'); e.focus(); const s = window.getSelection(); s.selectAllChildren(e); s.collapseToStart(); }, row(B, 'メールメッセージ'));
    await page.keyboard.type('この度はお問い合わせいただき、ありがとうございます。\n以下の内容で受け付けました。\n\n');
    await page.evaluate(() => document.activeElement.blur());
    await page.evaluate(b => eval(b).scrollIntoView({ block: 'start' }), B); await L.sleep(800);
    await L.shot(page, site, 'n09_filled');
    await L.rects(page, 'n09_filled', { to: `${to}.querySelector('.wpforms-smart-tags-widget-container')`, subject: `${row(B, 'メール件名')}.querySelector('.wpforms-smart-tags-widget-container')`, message: `${row(B, 'メールメッセージ')}.querySelector('.wpforms-smart-tags-widget-container')` });

    // 保存ボタンの場所（押さない）
    await page.evaluate(() => { const s = document.querySelector('#wpforms-save'); s.style.outline = '5px solid #e5262b'; s.style.outlineOffset = '4px'; });
    await L.shot(page, site, 'n10_save', { clip: { x: 0, y: 0, width: 1440, height: 300 } });

    // カスタム投稿に入れる（投稿は保存しない）
    const pt = site.postType || 'post';
    await page.goto(BASE + `/wp-admin/edit.php${pt === 'post' ? '' : '?post_type=' + pt}`, { waitUntil: 'networkidle2' });
    await L.shot(page, site, 'p01_menu');
    await L.rects(page, 'p01_menu', {
      menu: `document.querySelector('#adminmenu li.wp-has-current-submenu > a, #adminmenu li.current > a')`,
      add: `[...document.querySelectorAll('#adminmenu .wp-submenu a')].find(a => a.href.includes('post-new.php${pt === 'post' ? '' : '?post_type=' + pt}'))`,
    });
  } finally {
    L.saveRects(site);
    await browser.close();
  }

  // 新規投稿画面は別のブラウザで、保存系の通信を止めて撮る
  const { browser: b2, page: p2 } = await L.login(site);
  try {
    const pt = site.postType || 'post';
    await L.blockSaves(p2, pt === 'post' ? 'posts' : pt);
    await p2.goto(BASE + `/wp-admin/post-new.php${pt === 'post' ? '' : '?post_type=' + pt}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p2.waitForSelector('iframe[name=editor-canvas]', { timeout: 60000 });
    await L.sleep(6000);
    await p2.keyboard.press('Escape'); await L.sleep(800);
    const f = await (await p2.$('iframe[name=editor-canvas]')).contentFrame();
    await f.click('.editor-post-title, h1.wp-block-post-title');
    await p2.keyboard.type('見学会予約フォームのご案内');
    await L.shot(p2, site, 'p02_editor');
    await L.rects(p2, 'p02_editor', { title: `F:document.querySelector('.editor-post-title, h1.wp-block-post-title')`, inserter: `document.querySelector('.editor-document-tools__inserter-toggle')` });
    await p2.click('.editor-document-tools__inserter-toggle'); await L.sleep(1500);
    await p2.type('.block-editor-inserter__search input', 'WPForms'); await L.sleep(2000);
    await L.shot(p2, site, 'p03_inserter');
    await L.rects(p2, 'p03_inserter', { search: `document.querySelector('.block-editor-inserter__search input')`, block: `document.querySelector('.editor-block-list-item-wpforms-form-selector')` });
    await p2.click('.editor-block-list-item-wpforms-form-selector'); await L.sleep(3000);
    await L.shot(p2, site, 'p04_block');
    const sideSel = `[...document.querySelectorAll('.block-editor-block-inspector select')].find(x => x.options.length > 1)`;
    await L.rects(p2, 'p04_block', { canvasSelect: `F:document.querySelector('.wp-block-wpforms-form-selector select')`, sideSelect: sideSel });
    // 中身のあるフォームだけが選択肢に出る。site.selectForm（無ければ最初のフォーム）を見本として選ぶ
    const opts = await f.$$eval('.wp-block-wpforms-form-selector select option', os => os.map(o => [o.value, o.textContent.trim()]));
    const pick = (opts.find(([, t]) => site.selectForm && t.includes(site.selectForm)) || opts.find(([v]) => v))[0];
    await f.select('.wp-block-wpforms-form-selector select', pick); await L.sleep(5000);
    await L.shot(p2, site, 'p05_selected');
    await L.rects(p2, 'p05_selected', { blockWrap: `F:document.querySelector('.wp-block-wpforms-form-selector')`, preview: `document.querySelector('.editor-preview-dropdown__toggle')`, publish: `document.querySelector('.editor-post-publish-panel__toggle, .editor-post-publish-button__button')` });
  } finally {
    L.saveRects(site);
    await b2.close();
  }
})();
