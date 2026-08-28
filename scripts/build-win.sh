#!/usr/bin/env bash
set -euo pipefail

if [ "$(node -p "process.platform")" != "win32" ]; then
  echo "Windows 发布物必须在真正的 Windows runner 上构建。" >&2
  echo "请在 Windows x64 上运行 npm run pack:win。" >&2
  exit 1
fi

exec node scripts/build-win.js
