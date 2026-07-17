#!/bin/bash
# 在 macOS/Linux 上生成 Windows x64 免安装版和 zip 分发包。
set -e

APP_NAME="Git Status Monitor"
VERSION=$(node -p "require('./package.json').version")
ARCH="x64"
PLATFORM="win32"
DIST_DIR="dist"
APP_DIR="${DIST_DIR}/${APP_NAME}-${PLATFORM}-${ARCH}"
ZIP_NAME="${APP_NAME}-${VERSION}-${ARCH}-win.zip"
ZIP_PATH="${DIST_DIR}/${ZIP_NAME}"
ELECTRON_VERSION=$(node -p "require('electron/package.json').version")
PACKAGER_DOWNLOAD_ARGS=()

if [ -z "${ELECTRON_ZIP_DIR:-}" ]; then
  CACHED_ELECTRON_ZIP=$(find "${HOME}/Library/Caches/electron" -type f \
    -name "electron-v${ELECTRON_VERSION}-${PLATFORM}-${ARCH}.zip" -print -quit 2>/dev/null || true)
  if [ -n "${CACHED_ELECTRON_ZIP}" ]; then
    ELECTRON_ZIP_DIR=$(dirname "${CACHED_ELECTRON_ZIP}")
  fi
fi
if [ -n "${ELECTRON_ZIP_DIR:-}" ]; then
  echo "使用 Electron 本地缓存: ${ELECTRON_ZIP_DIR}"
  PACKAGER_DOWNLOAD_ARGS+=(--electron-zip-dir="${ELECTRON_ZIP_DIR}")
fi

echo "构建 ${APP_NAME} v${VERSION} (${PLATFORM}-${ARCH})"
rm -rf "${APP_DIR}" "${ZIP_PATH}"

npx @electron/packager . "${APP_NAME}" \
  --platform=${PLATFORM} \
  --arch=${ARCH} \
  --out=${DIST_DIR} \
  --asar \
  --overwrite \
  --prune=true \
  "${PACKAGER_DOWNLOAD_ARGS[@]}" \
  --ignore="^/dist($|/)|^/\.git($|/)|^/docs($|/)|^/scripts($|/)|(^|/)\.DS_Store$"

cat > "${APP_DIR}/resources/app-update.yml" << EOF
provider: github
owner: goldf2
repo: git-status-monitor
EOF

cat > "${APP_DIR}/start-app.bat" << 'EOF'
@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "SOURCE=%~dp0"
set "RUN_DIR=%~dp0"
if "!SOURCE:~0,2!"=="\\" (
  set "RUN_DIR=%LOCALAPPDATA%\GitStatusMonitor"
  if not exist "!RUN_DIR!" mkdir "!RUN_DIR!"
  robocopy "!SOURCE!" "!RUN_DIR!" /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul
)
pushd "!RUN_DIR!"
start "" "Git Status Monitor.exe"
popd
endlocal
EOF

cat > "${APP_DIR}/diagnostic-start.bat" << 'EOF'
@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
set "SOURCE=%~dp0"
set "RUN_DIR=%~dp0"
set "DIAGNOSTIC_LOG=%TEMP%\git-status-monitor-diagnostic.log"
if "!SOURCE:~0,2!"=="\\" (
  echo UNC path detected. Copying application to Windows local storage...
  set "RUN_DIR=%LOCALAPPDATA%\GitStatusMonitor"
  if not exist "!RUN_DIR!" mkdir "!RUN_DIR!"
  robocopy "!SOURCE!" "!RUN_DIR!" /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul
)
pushd "!RUN_DIR!"
set ELECTRON_ENABLE_LOGGING=1
set ELECTRON_ENABLE_STACK_DUMPING=1
echo Git Status Monitor diagnostic launch > "!DIAGNOSTIC_LOG!"
echo Source: !SOURCE! >> "!DIAGNOSTIC_LOG!"
echo Run directory: !RUN_DIR! >> "!DIAGNOSTIC_LOG!"
echo Time: %date% %time% >> "!DIAGNOSTIC_LOG!"
echo OS: >> "!DIAGNOSTIC_LOG!"
ver >> "!DIAGNOSTIC_LOG!" 2>&1
echo Architecture: %PROCESSOR_ARCHITECTURE% >> "!DIAGNOSTIC_LOG!"
echo. >> "!DIAGNOSTIC_LOG!"
"Git Status Monitor.exe" --enable-logging --v=1 --disable-gpu >> "!DIAGNOSTIC_LOG!" 2>&1
set "APP_EXIT_CODE=!errorlevel!"
echo. >> "!DIAGNOSTIC_LOG!"
echo Exit code: !APP_EXIT_CODE! >> "!DIAGNOSTIC_LOG!"
popd
echo.
echo Diagnostic log: !DIAGNOSTIC_LOG!
echo Temp log: %TEMP%\git-status-monitor-startup.log
pause
endlocal
EOF

# -X 排除 macOS 扩展属性，避免 ZIP 中出现 ._* AppleDouble 文件。
(
  cd "${DIST_DIR}"
  zip -r -q -X "${ZIP_NAME}" "${APP_NAME}-${PLATFORM}-${ARCH}"
)

echo "Windows 免安装版: ${APP_DIR}"
echo "Windows 分发包:   ${ZIP_PATH}"
