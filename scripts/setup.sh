#!/bin/bash
# 撮影・スライド作成に使う Node のパッケージ（budoux は日本語の改行位置を決めるのに使う）を、作業フォルダの node_modules に入れる。
#   bash setup.sh <作業フォルダ>
# このMacの既定の node は v16 で古いので、nvm の v22 を使う。
set -euo pipefail
WORK="${1:-.}"
NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/v22.* 2>/dev/null | sort -V | tail -1)/bin"
[ -x "$NODE_BIN/node" ] || { echo "node v22 が見つかりません（nvm install 22 が必要）" >&2; exit 1; }
cd "$WORK"
[ -f package.json ] || PATH="$NODE_BIN:$PATH" npm init -y >/dev/null
PATH="$NODE_BIN:$PATH" npm install --silent puppeteer-core pptxgenjs sharp budoux
python3 -c "import pymupdf, PIL" 2>/dev/null || pip3 install -q --break-system-packages pymupdf pillow
echo "NODE_BIN=$NODE_BIN"
echo "実行例: NODE_PATH=$(pwd)/node_modules PATH=$NODE_BIN:\$PATH node <script>"
