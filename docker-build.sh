#!/usr/bin/env bash
set -euo pipefail

VERSION=$(node -p "require('./package.json').version")
IMAGE="omophub/omophub-mcp"
PLATFORMS="linux/amd64,linux/arm64"

# Ensure buildx builder exists with multi-arch support
BUILDER_NAME="omophub-multiarch"
if ! docker buildx inspect "${BUILDER_NAME}" &>/dev/null; then
  echo "Creating buildx builder: ${BUILDER_NAME}"
  docker buildx create --name "${BUILDER_NAME}" --driver docker-container --use
else
  docker buildx use "${BUILDER_NAME}"
fi

echo "Building ${IMAGE}:${VERSION} for ${PLATFORMS}"

# --push builds and pushes multi-arch manifest in one step (required for multi-platform)
# To build locally for current platform only, use: docker build -t ${IMAGE}:${VERSION} .
docker buildx build \
  --platform "${PLATFORMS}" \
  -t "${IMAGE}:${VERSION}" \
  -t "${IMAGE}:latest" \
  --push \
  .

echo "Pushed ${IMAGE}:${VERSION} (${PLATFORMS})"
