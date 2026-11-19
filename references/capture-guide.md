# 撮影の手引きと、ハマりどころ

`scripts/lib.js` を使って、サイトごとの撮影スクリプト（capture.js）を書く。
見本は `examples/wpforms-new-form/capture.js`。

## lib.js の使い方

```js
const L = require('<skill>/scripts/lib.js');
const site = L.loadSite();                       // SITE_JSON か ./site.json
const { browser, page } = await L.login(site, { loginShot: '01_login' });  // ログイン画面も撮る
await page.goto(site.base + '/wp-admin/…', { waitUntil: 'networkidle2' });
await L.shot(page, site, 'n01_forms');           // ぼかし・置き換えをしてから撮る
await L.rects(page, 'n01_forms', {               // 赤枠を付ける部品の位置を記録
  menu: `document.querySelector('#toplevel_page_wpforms-overview > a')`,
  add:  `document.querySelector('.page-title-action')`,
});
L.saveRects(site);                               // rects.json に追記保存
```

- `rects` の式は、ブラウザの中で要素を1つ返す JavaScript。見つからなかった部品はログに `missing:` と出るので、その場で式を直して撮り直す。
- ブロックエディタの本文側（iframe の中）は式の頭に `F:` を付ける。位置は画面全体の座標に直して記録される。
- 撮影は 1440×900・2倍解像度。`deck.json` の `box` や `crop` もこの座標で書く。

## 会社名などを写さない

- `site.json` の `mask` で設定する。`blurWords` を含む要素はぼかし、`replace` の正規表現に合う文字は「〇〇」などに置き換える（画面上だけで、保存はしない）。
- 管理バーのサイト名・ユーザー名、ログイン画面の「〇〇へ移動」、一覧の投稿者列は最初からぼかす。
- 置き換えは入力欄の値・プレースホルダー・本文の文字のすべてに効く。メールアドレス、住所、電話番号、郵便番号もここで消す。
- 撮影後に必ず全画像を目で見る。一覧の記事タイトルなど、設定で拾えなかったものは PIL でぼかす：
  ```python
  from PIL import Image, ImageFilter
  im = Image.open('shots/p01_menu.png'); box = (x0*2, y0*2, x1*2, y1*2)   # 2倍解像度
  im.paste(im.crop(box).filter(ImageFilter.GaussianBlur(14)), box); im.save('shots/p01_menu.png')
  ```

## 本番サイトを汚さない

- 撮影は「画面を開いて操作するだけで、保存は押さない」が基本。作業途中の状態は DOM 上だけで作れる。
- 新規作成の流れを撮るには、本当に作らないと次の画面に進めないことがある（WPForms はテンプレートを選んだ時点でフォームが作られる）。その場合は**撮影前にユーザーへ確認**し、名前を「マニュアル用テスト」などにして、撮影後に削除する。
- 編集者アカウントは削除権限がないことが多い（WPForms のゴミ箱リンクが出ない）。管理者アカウントでの削除は、ユーザーの明示的な許可を得てから行う。許可がなければ、残っているものを ID 付きで報告して手動削除を依頼する。
- 新規投稿画面（post-new.php）を開くだけで auto-draft が作られる。一覧には出ず、WordPress が7日ほどで自動削除する。報告には書いておく。
- 新規投稿画面では自動保存で下書きになるのを防ぐため、`L.blockSaves(page, postType)` で保存系の通信を止めてから開く。
- 既存のフォームや記事を開いて撮る場合も、入力欄を書き換えたら保存せずに閉じる。

## ハマりどころ

- ログインのセッションは保存しない設定なので、スクリプトごとに `L.login` する。
- ブロックエディタは `networkidle2` に到達しない（常に通信がある）。`domcontentloaded` で開き、`iframe[name=editor-canvas]` を待ってから数秒待つ。最初に「ようこそ」ガイドが出るので Escape で閉じる。
- WPForms のスマートタグ欄（送信先・件名・本文）は `input` ではなく `contenteditable` の div。focus してキーボード入力する。タグの削除は `span.tag[data-value=…] i` をクリック。
- WPForms のブロックの選択肢には、項目が保存されたフォームしか出ない。見本の画面では既存のフォームを選んでよい（保存しないので影響なし）。
- 中身が空のスクリーンショット（読み込み途中）を防ぐため、操作のあとに 1〜2 秒待ってから撮る。
- zsh では `rm -f pg-*.png` のようなワイルドカードが0件だとコマンド全体が止まる。`find . -name 'pg-*.png' -delete` を使う。
- このMacの既定 node は v16 で、puppeteer-core が動かない。`setup.sh` が表示する v22 の PATH を使う。
