#!/bin/bash
# ============================================================
# macOS 构建脚本(使用 @electron/packager,绕过 electron-builder 卡死问题)
# 输出:
#   dist/Git Status Monitor-darwin-arm64/Git Status Monitor.app  — 可运行应用
#   dist/Git Status Monitor-{version}-arm64-mac.zip              — 自动升级包
#   dist/latest-mac.yml                                          — 升级元数据
# ============================================================
set -e

APP_NAME="Git Status Monitor"
VERSION=$(node -p "require('./package.json').version")
ARCH="arm64"
PLATFORM="darwin"
DIST_DIR="dist"
APP_DIR="${DIST_DIR}/${APP_NAME}-darwin-${ARCH}"
APP_PATH="${APP_DIR}/${APP_NAME}.app"
ZIP_NAME="${APP_NAME}-${VERSION}-${ARCH}-mac.zip"
ZIP_PATH="${DIST_DIR}/${ZIP_NAME}"
ELECTRON_VERSION=$(node -p "require('electron/package.json').version")
PACKAGER_DOWNLOAD_ARGS=()

# 优先使用本机 Electron 缓存，避免网络不稳定导致打包失败；也可手动指定 ELECTRON_ZIP_DIR
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

echo "=========================================="
echo " 构建 ${APP_NAME} v${VERSION} (${PLATFORM}-${ARCH})"
echo "=========================================="

# 清理旧构建
echo "[1/6] 清理旧构建..."
rm -rf "${APP_DIR}" "${ZIP_PATH}" "${DIST_DIR}/latest-mac.yml"

# 打包
echo "[2/6] 使用 @electron/packager 打包..."
npx @electron/packager . "${APP_NAME}" \
  --platform=${PLATFORM} \
  --arch=${ARCH} \
  --out=${DIST_DIR} \
  --asar \
  --overwrite \
  --prune=true \
  "${PACKAGER_DOWNLOAD_ARGS[@]}" \
  --ignore="^/dist($|/)|^/\.git($|/)|^/docs($|/)|^/scripts($|/)|(^|/)\.DS_Store$"

# @electron/packager 不会像 electron-builder 一样自动写入更新源配置
echo "[3/6] 写入自动更新源配置..."
cat > "${APP_PATH}/Contents/Resources/app-update.yml" << EOF
provider: github
owner: goldf2
repo: git-status-monitor
EOF

# 创建 zip(自动升级用)
echo "[4/6] 创建自动升级 zip..."
cd "${APP_DIR}"
ditto -c -k --keepParent "${APP_NAME}.app" "../${ZIP_NAME}"
cd - > /dev/null

# 生成 sha512 和大小
echo "[5/6] 生成升级元数据..."
# electron-updater 的 latest-mac.yml 要求 Base64 编码的 SHA-512
SHA512=$(openssl dgst -sha512 -binary "${ZIP_PATH}" | openssl base64 -A)
SIZE=$(stat -f%z "${ZIP_PATH}")
NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

cat > "${DIST_DIR}/latest-mac.yml" << EOF
version: ${VERSION}
files:
  - url: ${ZIP_NAME}
    sha512: ${SHA512}
    size: ${SIZE}
path: ${ZIP_NAME}
sha512: ${SHA512}
releaseDate: '${NOW}'
EOF

echo "[6/6] 构建完成!"
echo ""
echo "  应用:     ${APP_PATH}"
echo "  升级包:   ${ZIP_PATH}"
echo "  元数据:   ${DIST_DIR}/latest-mac.yml"
echo "  版本:     ${VERSION}"
echo ""
echo "未签名应用首次打开需: 右键 → 打开 (或 xattr -cr \"${APP_PATH}\")"
