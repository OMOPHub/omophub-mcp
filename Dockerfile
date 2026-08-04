FROM node:24-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build && \
    rm -rf node_modules && \
    npm ci --omit=dev --ignore-scripts

FROM gcr.io/distroless/nodejs24-debian12:nonroot

WORKDIR /app
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

ENV MCP_TRANSPORT=http
ENV MCP_PORT=3100

EXPOSE 3100

# Passed in by the build workflow rather than hardcoded: this label sat at 1.5.3
# through the 1.6.0 bump because nothing links it to package.json, so an image
# could report a version it was not built from. docker-build.sh and
# .github/workflows/build-image.yml read the version from package.json.
ARG IMAGE_VERSION=dev

LABEL org.opencontainers.image.title="omophub-mcp" \
      org.opencontainers.image.description="MCP server for OHDSI OMOP standardized medical vocabularies" \
      org.opencontainers.image.version="${IMAGE_VERSION}" \
      org.opencontainers.image.source="https://github.com/OMOPHub/omophub-mcp"

ENTRYPOINT ["/nodejs/bin/node", "dist/index.js"]
