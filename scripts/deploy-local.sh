#!/usr/bin/env bash
set -euo pipefail

GAME_ID="${GAME_ID:-ultraace}"
VERSION="${GAME_VERSION:-$(node -p "require('./apps/ultra-ace-web/package.json').version")}"
ARCADE_SHELL_PATH="${ARCADE_SHELL_PATH:-../arcade-shell}"

OUT_DIR="dist-package/${GAME_ID}-${VERSION}"
TARGET_DIR="${ARCADE_SHELL_PATH}/apps/ui/public/games/${GAME_ID}"

echo "[deploy-local] Packaging ${GAME_ID}@${VERSION}"
bash scripts/package.sh

if [[ ! -d "$OUT_DIR" ]]; then
  echo "[deploy-local] Missing package output: $OUT_DIR"
  exit 1
fi

echo "[deploy-local] Replacing ${TARGET_DIR}"
rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"
cp -a "$OUT_DIR"/. "$TARGET_DIR"/

echo "[deploy-local] Done"
echo "[deploy-local] Source : $OUT_DIR"
echo "[deploy-local] Target : $TARGET_DIR"
