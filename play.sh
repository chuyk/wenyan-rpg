#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
PORT="${1:-8000}"

echo "與宋元思書・山水謎境"
echo "啟動本機伺服器：http://localhost:$PORT"
echo "（請用 Chrome / Edge 開啟，勿直接雙擊 index.html）"
echo "停止：Ctrl + C"
echo

if command -v python3 > /dev/null 2>&1; then
  python3 -m http.server "$PORT"
elif command -v python > /dev/null 2>&1; then
  python -m SimpleHTTPServer "$PORT"
elif command -v npx > /dev/null 2>&1; then
  npx --yes serve -l "$PORT" .
else
  echo "找不到 python3 或 npx，請先安裝其中之一。" >&2
  exit 1
fi