# Changelog

## [1.1.0] - 2026-03-05

### Added

- Streamable HTTP transport (`--transport=http`) with `/mcp` endpoint
- Health check endpoint (`/health`) for container orchestration
- MCP Registry support (`server.json`, `mcpName`)
- Scoped npm package (`@omophub/omophub-mcp`)

### Changed

- Package name from `omophub-mcp` to `@omophub/omophub-mcp`

## [1.0.0] - 2026-02-28

### Added

- 6 core tools: `search_concepts`, `get_concept`, `get_concept_by_code`, `map_concept`, `get_hierarchy`, `list_vocabularies`
- stdio transport for Claude Desktop, Claude Code, Cursor, VS Code, Gemini CLI
- LRU caching with configurable TTLs for concept, hierarchy, and vocabulary data
- Dual-format responses (human-readable markdown + structured JSON) for optimal agent chaining
- MCP Resources: vocabulary catalog and vocabulary details
- MCP Prompts: phenotype concept set builder and code lookup
- Retry logic with Retry-After support for rate-limited requests
- Actionable error messages with status-specific guidance
- Analytics headers (opt-out available via `OMOPHUB_ANALYTICS_OPTOUT`)
- Docker support via multi-stage build
- npm distribution (`npx omophub-mcp`)
