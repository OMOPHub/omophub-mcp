# Changelog

## [1.4.0] - 2026-04-10

### Added

- **FHIR-to-OMOP Concept Resolver** — 3 new tools for translating FHIR coded values into OMOP standard concepts:
  - `fhir_resolve`: Resolve a single FHIR Coding (system URI + code) to its OMOP standard concept, CDM target table, and optional Phoebe recommendations. Supports text-only input via semantic search fallback.
  - `fhir_resolve_batch`: Batch-resolve up to 100 FHIR codings in one call. Failed items are reported inline without failing the batch.
  - `fhir_resolve_codeable_concept`: Resolve a FHIR CodeableConcept with multiple codings. Picks the best match per OHDSI vocabulary preference (SNOMED > RxNorm > LOINC > CVX > ICD-10). Falls back to the `text` field via semantic search.

### Fixed

- Non-null assertions in HTTP transport replaced with proper guard clauses (`noNonNullAssertion` lint rule)
- Bracket notation on `resolve.ts` header access replaced with dot notation (`useLiteralKeys` lint rule)

### Changed

- Tool count updated from 9 to 12
- Overall test coverage increased

## [1.3.1] - 2026-04-06

### Fixed

- Per-session HTTP transport - each client gets its own MCP session, fixing 500 errors on concurrent connections
- GET (SSE) and DELETE (session close) no longer fail with "Parse error" from body-reading logic
- Request body size limit (1 MB) to prevent memory exhaustion
- Consistent JSON-RPC error format on all 500 responses
- Safe `mcp-session-id` header normalization (handles string arrays)

### Changed

- HTTP transport uses per-session architecture with session tracking via `mcp-session-id`

## [1.3.0] - 2026-04-02

### Added

- Per-client API key resolution via `Authorization: Bearer` header for hosted deployments
- Cloud Run deployment workflow (`.github/workflows/deploy-cloudrun.yml`)
- Root endpoint `/` support for cleaner hosted URLs (alongside `/mcp` for backward compatibility)
- CORS `Authorization` header support for cross-origin Bearer token requests

### Fixed

- `list_vocabularies` now fetches all pages (130+ vocabularies) instead of only the first 100 - SNOMED and other late-alphabet vocabularies are no longer missing
- `map_concept` correctly displays target concept fields from the API response - no more `undefined` in mapping results

### Changed

- All 9 tools and 2 resources now resolve client per-request (supports multi-client hosted mode)
- HTTP transport accepts both `/` and `/mcp` endpoints with query string support

## [1.2.2] - 2026-04-01

### Fixed

- Update dashboard URL in auth error message to `dashboard.omophub.com/api-keys`
- Fix test assertion to match updated URL

## [1.2.1] - 2026-03-31

### Fixed

- Propagate original error when concept fetch fails in `explore_concept` instead of generic "not found"
- Update dashboard URLs in error messages and README to `dashboard.omophub.com`

## [1.2.0] - 2026-03-27

### Added

- `semantic_search` tool - natural language concept search using neural embeddings
- `find_similar_concepts` tool - find related concepts by semantic, lexical, or hybrid similarity
- `explore_concept` tool - unified concept exploration (details + hierarchy + mappings in one call)

### Fixed

- Defensive handling of missing `similarity_score` in semantic search and similar results
- Filter empty strings from comma-separated vocabulary/domain ID inputs

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
