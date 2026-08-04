# Changelog

## [Unreleased]

## [1.6.1] - 2026-08-04

Both issues reported by a user building NDC code lists with `search_concepts`. Both
were in this layer; the API was returning correct data in each case.

### Fixed

- **`search_concepts` ignored `vocabulary_ids` entirely.** The tool sent the filter as `vocabularies`, which `GET /v1/search/concepts` does not recognise — and unknown query params are ignored rather than rejected, so the request silently ran unfiltered across every vocabulary. A search restricted to NDC came back as RxNorm, dm+d, VANDF, NDFRT, Nebraska Lexicon and others, **with no NDC rows at all**, while reporting success. `semantic_search` and `get_hierarchy` already sent `vocabulary_ids` correctly; this tool was the only one out of step. An existing test asserted the wrong name and so locked the bug in — it has been corrected and paired with a test that fails if `vocabularies` is ever sent again.
- **`search_concepts` dropped concept validity.** The API returns `valid_start_date`, `valid_end_date` and `invalid_reason` on every concept; the formatter's projection discarded all three, so a deprecated code was indistinguishable from a live one. Results now show `Valid: <start> → <end>` and an explicit `[INVALID: <reason>]` marker in the text block, and carry all three fields in the JSON block. This matters most for exactly the case reported: a drug code list that silently includes retired NDCs is wrong in a way nothing in the output reveals.

## [1.6.0] - 2026-08-04

### Fixed

- **`map_concept` returned at most 100 mappings with no way to get the rest, and no indication any were missing.** It now accepts `page` and `page_size` (1-200, default 100). Requires the corresponding API fix, which adds pagination to `GET /v1/concepts/{id}/mappings` - that endpoint previously applied an unparameterised `LIMIT 100` in SQL with no total and no `has_next`. A concept with 1,500 mappings yielded 100 of them and nothing said so, which for anyone building a code list is a wrong answer wearing the costume of a right one.
- **`map_concept` output now states when it is showing a partial set.** The text block appends `Showing 100 of 1500 mappings (page 1 of 15). Call again with page=2 for the rest.`, and the JSON gains `returned_count`, `page`, `page_size`, `total_pages` and `has_more`; `total_mappings` now carries the true total rather than the length of the current page. The text matters as much as the JSON - this output is read by a model deciding whether it has finished, and rows under a bare header read as the whole set.
- **`explore_concept` could report "no mappings found" for a concept that has mappings.** It fetched the first 100 relationships of *every* type and narrowed to `Maps to`/`Mapped from` afterwards in JS, so a concept whose first 100 relationships were hierarchy links lost its mappings to truncation. Filtering now happens server-side via `relationship_ids`, and `target_vocabularies` is passed as `vocabulary_ids` instead of being applied after the fact.
- **`hierarchy` advertised a `max_results` ceiling the server would not honour.** It accepted up to 500 and defaulted to 500, but the value is sent as `page_size` on a GET and the API clamps that to 200 - so a request for 500 nodes returned 200, and the tool's own truncation notice reported the clamped figure, understating what was missing. Now 1-200, default 200.

### Changed

- Tool `page_size` ceilings now match what the API will actually serve, rather than sitting arbitrarily below it: `find_similar` 100 → 1000 (a POST body param, so the GET clamp does not apply), `search_concepts` 50 → 200, `semantic_search` 50 → 100 (that route validates stricter than the clamp). Declaring a ceiling above the server's is its own bug - the caller asks for N and silently receives fewer.
- `explore_concept` gains `mappings_page_size` (1-200, default 100), previously hardcoded at 100 with no caller control.

### Notes

- `find_similar` is ranked embedding similarity. Raising its ceiling returns more of a fuzzy ordering; it does not make the result exhaustive. Complete code lists are a `map_concept` / hierarchy job, and the tool descriptions now say so.

## [1.5.3] - 2026-07-20

### Fixed

- **HTTP transport session leak (out-of-memory crashes).** Sessions were only released when a client sent an explicit `DELETE`. Sessions are now reaped on a 30-minute idle timeout with a session-count backstop after their SSE stream closes; sessions with an open SSE stream are treated as active and are not reaped, so connected clients receiving server pushes are not disconnected.
- **HTTP transport crash on aborted requests.** A client aborting mid-request surfaced as an unhandled `Error: aborted` (`ECONNRESET`) that terminated the process. Aborted requests are now caught at their boundary and logged at debug level; the server keeps serving other sessions.
- **Process-level safety nets.** Added top-level `unhandledRejection` and `uncaughtException` handlers. Since the one routine async failure (an aborted request) is now handled at its boundary, anything reaching these handlers is a genuine unknown, so both log and exit for a clean supervised restart rather than resuming in an unknown state. The handlers normalize any thrown value (a non-`Error` or `null` throw no longer crashes the handler itself) and stay alive briefly so the diagnostic flushes to `stderr` before exit. Note: this assumes the container runs under a restart policy (`always` or `unless-stopped`).

### Changed

- CI `build-image` workflow: image publishes are serialized via a single fixed `concurrency` group (not keyed on branch) so runs from any branch can't race and leave `:latest` pointing at the older build, and the optional extra image tag is now included in the build summary.

## [1.5.2] - 2026-06-02

### Changed

- Bumped `vitest` and `@vitest/coverage-v8` devDependencies from `^3.2.4` to `^4.1.8`. 

## [1.5.1] - 2026-06-01

### Changed

- The `semantic_search` tool now calls the canonical API path `GET /v1/search/semantic` instead of `GET /v1/concepts/semantic-search`. The legacy path remains a permanent server-side alias, so older MCP installations continue to work - no breaking change. Hosted clients at [mcp.omophub.com](https://mcp.omophub.com) get the new path automatically.

## [1.5.0] - 2026-05-25

### Added

- `fhir_resolve` output now surfaces `value_as_concept` (with `value_target_field`) when the API decomposes a composite concept via `Maps to value` (HL7 FHIR-to-OMOP IG Value-as-Concept pattern), plus `concept_map_id` / `mapping_note` for FHIR administrative-code resolutions.

- `fhir_resolve_codeable_concept` codings accept `user_selected`; a user-selected coding wins over vocabulary preference (FHIR-to-OMOP IG CodeableConcept pattern).

- `fhir_resolve` and `fhir_resolve_codeable_concept` accept `on_unmapped` (`error` default / `sentinel`); with `sentinel` the resolver returns a `concept_id` 0 record instead of a 404 when nothing resolves (parity with the Python and R SDKs).

### Changed

- `fhir_resolve` now presents the OMOP `concept_id` 0 sentinel as **Unmapped** rather than as a successful resolution, so agents don't treat "no matching concept" as a real mapping.

## [1.4.0] - 2026-04-10

### Added

- **FHIR-to-OMOP Concept Resolver** - 2 new tools for translating FHIR coded values into OMOP standard concepts:
  - `fhir_resolve`: Resolve a single FHIR Coding (system URI + code) to its OMOP standard concept, CDM target table, and optional Phoebe recommendations. Supports text-only input via semantic search fallback.
  - `fhir_resolve_codeable_concept`: Resolve a FHIR CodeableConcept with multiple codings. Picks the best match per OHDSI vocabulary preference (SNOMED > RxNorm > LOINC > CVX > ICD-10). Falls back to the `text` field via semantic search.

### Fixed

- Non-null assertions in HTTP transport replaced with proper guard clauses (`noNonNullAssertion` lint rule)
- Bracket notation on `resolve.ts` header access replaced with dot notation (`useLiteralKeys` lint rule)

### Changed

- Tool count updated from 9 to 11
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
