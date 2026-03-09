#!/usr/bin/env bash
set -euo pipefail

GAME_ID="${GAME_ID:-ultraace}"
VERSION="${GAME_VERSION:-$(node -p "require('./apps/ultra-ace-web/package.json').version")}"

echo "[package-encrypted] building package for ${GAME_ID}@${VERSION}"
bash scripts/package.sh

echo "[package-encrypted] encrypting bundle"
node scripts/encrypt-package.mjs "$GAME_ID" "$VERSION"

ENC_FILE="dist-package/encrypted/${GAME_ID}/${VERSION}/${GAME_ID}-${VERSION}.enc"
MANIFEST_FILE="dist-package/encrypted/${GAME_ID}/${VERSION}/manifest.enc.json"

if [[ -n "${OBJECT_STORAGE_PUT_URL:-}" ]]; then
  echo "[package-encrypted] uploading via presigned URL"
  curl --fail --show-error -X PUT --upload-file "$ENC_FILE" "$OBJECT_STORAGE_PUT_URL"
  echo "[package-encrypted] upload complete"
  echo "[package-encrypted] games.package_url=${OBJECT_STORAGE_PUT_URL%%\?*}"
elif [[ -n "${AWS_S3_URI:-}" ]]; then
  echo "[package-encrypted] uploading via aws s3 cp"
  aws s3 cp "$ENC_FILE" "$AWS_S3_URI"
  echo "[package-encrypted] upload complete"
  echo "[package-encrypted] games.package_url=${AWS_S3_URI}"
else
  echo "[package-encrypted] no upload target configured"
fi

echo "[package-encrypted] manifest: ${MANIFEST_FILE}"
echo "[package-encrypted] encrypted: ${ENC_FILE}"
