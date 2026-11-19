#!/bin/bash
# pptx を PDF に書き出す。
#   export_pdf.sh input.pptx output.pdf
# Mac の PowerPoint はサンドボックスのため、任意のフォルダのファイルを開くと失敗することがある（-9074）。
# PowerPoint 専用フォルダに毎回別名でコピーしてから書き出す（同じ名前だと古い版を書き出すことがある）。
# PowerPoint が無い場合は LibreOffice（soffice）を使う。
set -euo pipefail
IN="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
OUT="$2"
C="$HOME/Library/Containers/com.microsoft.Powerpoint/Data/Documents"

if [ -d "/Applications/Microsoft PowerPoint.app" ] && [ -d "$C" ]; then
  TAG="wpmv_$(date +%s)"
  cp "$IN" "$C/$TAG.pptx"
  osascript <<EOF
with timeout of 180 seconds
tell application "Microsoft PowerPoint"
  open POSIX file "$C/$TAG.pptx"
  delay 4
  set p to active presentation
  save p in (POSIX file "$C/$TAG.pdf") as save as PDF
  close p saving no
end tell
end timeout
EOF
  cp "$C/$TAG.pdf" "$OUT"
  rm -f "$C/$TAG.pptx" "$C/$TAG.pdf"
elif command -v soffice >/dev/null; then
  TMP="$(mktemp -d)"
  soffice --headless --convert-to pdf --outdir "$TMP" "$IN" >/dev/null
  cp "$TMP/$(basename "${IN%.*}").pdf" "$OUT"
  rm -rf "$TMP"
else
  echo "PowerPoint も LibreOffice も見つかりません" >&2
  exit 1
fi
echo "wrote $OUT"
