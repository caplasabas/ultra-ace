#!/usr/bin/env bash
set -e

GAME_ID="ultraace"
VERSION=$(node -p "require('./apps/ultra-ace-web/package.json').version")
OUT_DIR="dist-package/${GAME_ID}-${VERSION}"
ENGINE_VERSION=$(node -p "require('./packages/engine/package.json').version")

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

echo "🔧 Building engine"
npm run build --workspace=@ultra-ace/engine

echo "🎮 Building web"
VITE_GAME_VERSION="$VERSION" npm run build --workspace=ultra-ace-web

echo "📦 Packaging"
cp -r apps/ultra-ace-web/dist/* "$OUT_DIR/"

cat > "$OUT_DIR/manifest.json" <<EOF
{
  "gameId": "$GAME_ID",
  "name": "Ultra Ace",
  "type": "casino",
  "version": "$VERSION",
  "entry": "index.html",
  "engine": "@ultra-ace/engine",
  "engineVersion": "1.0.0",
  "buildTime": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "engineVersion": "$ENGINE_VERSION"
}
EOF

(
  cd "$OUT_DIR"
  find . -type f ! -name checksum.sha256 -exec sha256sum {} \; > checksum.sha256
)

echo "✅ Packaged $GAME_ID $VERSION"
