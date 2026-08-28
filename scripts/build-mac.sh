#!/bin/bash
# ============================================================
# macOS 构建脚本（使用 @electron/packager）
# 默认生成经过 ad-hoc 签名的本机开发包。
# GITFINDER_RELEASE_MODE=official 时必须使用 Developer ID 签名并完成 Apple 公证，
# 任一正式发布门禁不通过都会停止构建，不能生成可上传附件。
# 输出:
#   dist/GitFinder-darwin-arm64/GitFinder.app  — 可运行应用
#   dist/GitFinder-{version}-arm64-mac.zip      — 自动升级包
#   dist/latest-mac.yml                                          — 升级元数据
# ============================================================
set -e

APP_NAME="GitFinder"
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
PACKAGER_SECURITY_ARGS=()
RELEASE_MODE="${GITFINDER_RELEASE_MODE:-development}"

if [ "${RELEASE_MODE}" != "development" ] && [ "${RELEASE_MODE}" != "official" ]; then
  echo "无效的 GITFINDER_RELEASE_MODE: ${RELEASE_MODE}" >&2
  exit 1
fi

SOURCE_GATE_ARGS=(--phase source --mode "${RELEASE_MODE}")
if [ -n "${GITFINDER_EXPECTED_TAG:-}" ]; then
  SOURCE_GATE_ARGS+=(--expected-tag "${GITFINDER_EXPECTED_TAG}")
fi

if [ "${RELEASE_MODE}" = "official" ]; then
  REQUIRED_RELEASE_VARS=(
    GITFINDER_CODESIGN_IDENTITY
    APPLE_TEAM_ID
    GITFINDER_EXPECTED_TAG
    GITFINDER_NOTARY_KEYCHAIN_PROFILE
  )
  for REQUIRED_VAR in "${REQUIRED_RELEASE_VARS[@]}"; do
    if [ -z "${!REQUIRED_VAR:-}" ]; then
      echo "正式发布缺少环境变量: ${REQUIRED_VAR}" >&2
      exit 1
    fi
  done
  case "${GITFINDER_CODESIGN_IDENTITY}" in
    "Developer ID Application:"*) ;;
    *)
      echo "GITFINDER_CODESIGN_IDENTITY 必须是 Developer ID Application 身份。" >&2
      exit 1
      ;;
  esac
  PACKAGER_SECURITY_ARGS+=(
    --osx-sign.identity="${GITFINDER_CODESIGN_IDENTITY}"
    --osx-sign.hardenedRuntime
    --no-osx-sign.continueOnError
    --osx-notarize.keychainProfile="${GITFINDER_NOTARY_KEYCHAIN_PROFILE}"
  )
  if [ -n "${GITFINDER_CODESIGN_KEYCHAIN:-}" ]; then
    PACKAGER_SECURITY_ARGS+=(
      --osx-sign.keychain="${GITFINDER_CODESIGN_KEYCHAIN}"
      --osx-notarize.keychain="${GITFINDER_CODESIGN_KEYCHAIN}"
    )
  fi
fi

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
echo " 构建 ${APP_NAME} v${VERSION} (${PLATFORM}-${ARCH}, ${RELEASE_MODE})"
echo "=========================================="

# 源码、版本和发布身份必须在删除旧构建前先通过。
echo "[1/8] 验证发布源码..."
node scripts/verify-release.js "${SOURCE_GATE_ARGS[@]}"

# 清理旧构建
echo "[2/8] 清理旧构建..."
rm -rf "${APP_DIR}" "${ZIP_PATH}" "${DIST_DIR}/latest-mac.yml"

# 打包
echo "[3/8] 使用 @electron/packager 打包..."
npx @electron/packager . "${APP_NAME}" \
  --platform=${PLATFORM} \
  --arch=${ARCH} \
  --out=${DIST_DIR} \
  --asar \
  --overwrite \
  --prune=true \
  --icon=public/icon.icns \
  --app-bundle-id=com.gitfinder.app \
  --app-version="${VERSION}" \
  --extra-resource=resources/app-update.yml \
  "${PACKAGER_DOWNLOAD_ARGS[@]}" \
  "${PACKAGER_SECURITY_ARGS[@]}" \
  --ignore="^/dist($|/)|^/\.git($|/)|^/docs($|/)|^/scripts($|/)|^/resources($|/)|^/public/icon-master\.png$|(^|/)\.DS_Store$"

# 正式模式已由 Packager 在打包阶段签名、公证和附加票据；开发模式保持 ad-hoc。
echo "[4/8] 完成签名策略..."
if [ "${RELEASE_MODE}" = "development" ]; then
  codesign --force --deep --sign - --identifier com.gitfinder.app "${APP_PATH}"
else
  echo "已完成 Developer ID 签名与 Apple 公证。"
fi

# 创建 zip(自动升级用)
echo "[5/8] 创建自动升级 zip..."
cd "${APP_DIR}"
ditto -c -k --keepParent "${APP_NAME}.app" "../${ZIP_NAME}"
cd - > /dev/null

# 生成 sha512 和大小
echo "[6/8] 生成升级元数据..."
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

echo "[7/8] 验证发布产物..."
ARTIFACT_GATE_ARGS=(
  --phase artifact
  --mode "${RELEASE_MODE}"
  --report dist/release-verification.json
)
if [ -n "${GITFINDER_EXPECTED_TAG:-}" ]; then
  ARTIFACT_GATE_ARGS+=(--expected-tag "${GITFINDER_EXPECTED_TAG}")
fi
if [ -n "${APPLE_TEAM_ID:-}" ]; then
  ARTIFACT_GATE_ARGS+=(--expected-team-id "${APPLE_TEAM_ID}")
fi
node scripts/verify-release.js "${ARTIFACT_GATE_ARGS[@]}"

echo "[8/8] 构建完成!"
echo ""
echo "  应用:     ${APP_PATH}"
echo "  升级包:   ${ZIP_PATH}"
echo "  元数据:   ${DIST_DIR}/latest-mac.yml"
echo "  验证报告: ${DIST_DIR}/release-verification.json"
echo "  版本:     ${VERSION}"
echo "  模式:     ${RELEASE_MODE}"
echo ""
if [ "${RELEASE_MODE}" = "development" ]; then
  echo "开发包仅为 ad-hoc 签名，不具备正式分发资格。"
fi
