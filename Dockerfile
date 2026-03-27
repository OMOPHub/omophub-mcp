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

LABEL org.opencontainers.image.title="omophub-mcp" \
      org.opencontainers.image.description="MCP server for OHDSI OMOP standardized medical vocabularies" \
      org.opencontainers.image.version="1.2.0" \
      org.opencontainers.image.source="https://github.com/OMOPHub/omophub-mcp"

ENTRYPOINT ["/nodejs/bin/node", "dist/index.js"]
