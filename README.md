# OMOPHub MCP Server

MCP server for [OHDSI OMOP](https://www.ohdsi.org/) standardized medical vocabularies. Search, look up, map, and navigate 500M+ medical concepts (SNOMED CT, ICD-10, RxNorm, LOINC, and more) directly from AI agents.

## Quick Start

### 1. Get an API Key

Sign up at [omophub.com](https://omophub.com) and create an API key in your [dashboard](https://omophub.com/dashboard/api-keys).

### 2. Configure Your AI Client

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "omophub": {
      "command": "npx",
      "args": ["-y", "omophub-mcp"],
      "env": {
        "OMOPHUB_API_KEY": "oh_your_key_here"
      }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add omophub -- npx -y omophub-mcp
# Then set OMOPHUB_API_KEY in your environment
```

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "omophub": {
      "command": "npx",
      "args": ["-y", "omophub-mcp"],
      "env": {
        "OMOPHUB_API_KEY": "oh_your_key_here"
      }
    }
  }
}
```

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "omophub": {
      "command": "npx",
      "args": ["-y", "omophub-mcp"],
      "env": {
        "OMOPHUB_API_KEY": "oh_your_key_here"
      }
    }
  }
}
```

**Docker:**

```bash
docker run -i -e OMOPHUB_API_KEY=oh_your_key_here -p 8080:8080 omophub/omophub-mcp
```

### 3. Start Using It

Ask your AI assistant:

> "What's the OMOP concept ID for type 2 diabetes?"

> "Map ICD-10 code E11.9 to SNOMED"

> "Show me all descendants of Diabetes mellitus in SNOMED"

## Available Tools

| Tool | Description |
|------|-------------|
| `search_concepts` | Search for medical concepts by name or clinical term across all vocabularies |
| `get_concept` | Get detailed info about a specific OMOP concept by concept_id |
| `get_concept_by_code` | Look up a concept using a vocabulary-specific code (e.g., ICD-10 "E11.9") |
| `map_concept` | Map a concept to equivalent concepts in other vocabularies |
| `get_hierarchy` | Navigate concept hierarchy — ancestors, descendants, or both |
| `list_vocabularies` | List available medical vocabularies with statistics |

## Example Prompts

### Find a Concept

> "Search for metformin in RxNorm"

Uses `search_concepts` with `vocabulary_ids: "RxNorm"` to find metformin concepts.

### Cross-Vocabulary Mapping

> "I have SNOMED concept 201826 — what's the ICD-10 code?"

Uses `map_concept` with `target_vocabularies: "ICD10CM"` to find the mapping.

### Build a Concept Set

> "Help me build a concept set for Type 2 diabetes including all descendants"

Uses `search_concepts` → `get_hierarchy` (direction: down) → `map_concept` to build a complete phenotype definition.

### Validate a Code

> "Is ICD-10 code E11.9 a valid code? What does it map to in SNOMED?"

Uses `get_concept_by_code` → `map_concept` to validate and find mappings.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OMOPHUB_API_KEY` | Yes | Your OMOPHub API key |
| `OMOPHUB_BASE_URL` | No | Custom API base URL (default: `https://api.omophub.com/v1`) |
| `OMOPHUB_LOG_LEVEL` | No | Log level: `debug`, `info`, `warn`, `error` (default: `info`) |
| `OMOPHUB_ANALYTICS_OPTOUT` | No | Set to `true` to disable analytics headers |
| `HEALTH_PORT` | No | Port for HTTP health endpoint (default: disabled; set to enable) |

## CLI Arguments

```bash
npx omophub-mcp --api-key=oh_your_key --base-url=https://custom.api.com/v1 --health-port=8080
```

## Health Endpoint

When running in Docker or Kubernetes, enable the health endpoint for liveness/readiness probes:

```bash
# Via environment variable
HEALTH_PORT=8080 OMOPHUB_API_KEY=oh_your_key npx omophub-mcp

# Via CLI argument
npx omophub-mcp --health-port=8080

# Test it
curl http://localhost:8080/health
# → {"status":"ok","version":"1.0.0","uptime_seconds":42}
```

The Docker image enables the health endpoint on port 8080 by default.

## MCP Resources

- `omophub://vocabularies` — Full vocabulary catalog with statistics
- `omophub://vocabularies/{vocabulary_id}` — Details for a specific vocabulary

## MCP Prompts

- **phenotype-concept-set** — Guided workflow to build a concept set for a clinical phenotype
- **code-lookup** — Look up and validate a medical code with mappings and hierarchy

## Development

```bash
git clone https://github.com/OMOPHub/omophub-mcp.git
cd omophub-mcp
npm install
npm run build
npm test
```

Run locally:

```bash
OMOPHUB_API_KEY=oh_your_key npx tsx src/index.ts
```

## Troubleshooting

### "API key required" Error

Make sure `OMOPHUB_API_KEY` is set in your environment or MCP server config.

### "Authentication failed" Error

Your API key may be invalid or expired. Generate a new one at [omophub.com/dashboard/api-keys](https://omophub.com/dashboard/api-keys).

### "Rate limit exceeded" Error

The server automatically retries rate-limited requests. If you consistently hit limits, upgrade your plan at [omophub.com/dashboard/billing](https://omophub.com/dashboard/billing).

### Tools Not Appearing

1. Restart your AI client after configuration changes
2. Check that `npx omophub-mcp` runs without errors
3. Verify the config file path is correct for your client

## License

MIT — see [LICENSE](LICENSE)
