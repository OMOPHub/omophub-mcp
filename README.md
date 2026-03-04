<h1>OMOPHub MCP Server</h1>

<p>
  <strong>Medical vocabularies for AI agents.</strong><br/>
  Search, map, and navigate 5M+ OMOP concepts: SNOMED CT, ICD-10, RxNorm, LOINC, and more. Directly from Claude, Cursor, VS Code, or any MCP-compatible client.
</p>

<p>
  <a href="https://www.npmjs.com/package/omophub-mcp"><img src="https://img.shields.io/npm/v/omophub-mcp?style=flat-square&color=cb3837&label=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/omophub-mcp"><img src="https://img.shields.io/npm/dm/omophub-mcp?style=flat-square&color=blue" alt="npm downloads" /></a>
  <a href="https://github.com/OMOPHub/omophub-mcp/blob/main/LICENSE"><img src="https://img.shields.io/github/license/OMOPHub/omophub-mcp?style=flat-square" alt="License" /></a>
  <a href="https://github.com/OMOPHub/omophub-mcp"><img src="https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-compatible-green?style=flat-square" alt="MCP Compatible" /></a>
</p>

<p>
  <a href="#quick-start">Quick Start</a> ·
  <a href="#available-tools">Tools</a> ·
  <a href="#example-prompts">Examples</a> ·
  <a href="https://docs.omophub.com">Docs</a> ·
  <a href="https://omophub.com">Website</a>
</p>

---

## Why OMOPHub MCP?

Working with medical vocabularies today means downloading multi-gigabyte CSV files, loading them into a local database, and writing SQL to find what you need. Every time.

**OMOPHub MCP Server gives your AI assistant instant access to the entire OHDSI ATHENA vocabulary**. No database setup, no CSV wrangling, no context switching. Just ask.

```
You: "Map ICD-10 code E11.9 to SNOMED"

Claude: Found it - E11.9 (Type 2 diabetes mellitus without complications)
        maps to SNOMED concept 201826 (Type 2 diabetes mellitus)
        via standard 'Maps to' relationship.
```

**Use cases:**
- **Concept lookup** - Find OMOP concept IDs for clinical terms in seconds
- **Cross-vocabulary mapping** - Map between ICD-10, SNOMED, RxNorm, LOINC, and 100+ vocabularies
- **Hierarchy navigation** - Explore ancestors and descendants for phenotype definitions
- **Concept set building** - Let your AI agent assemble complete concept sets for cohort definitions
- **Code validation** - Verify medical codes and check their standard mappings

---

## Quick Start

### 1. Get an API Key

Sign up at [omophub.com](https://omophub.com) → create an API key in your [dashboard](https://omophub.com/dashboard/api-keys).

### 2. Add to Your AI Client

<details open>
<summary><strong>Claude Desktop</strong></summary>

Open Claude Desktop settings > "Developer" tab > "Edit Config". Add to `claude_desktop_config.json`:

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

</details>

<details>
<summary><strong>Claude Code</strong></summary>

```bash
claude mcp add omophub -- npx -y omophub-mcp
# Then set OMOPHUB_API_KEY in your environment
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

Open the command palette and choose "Cursor Settings" > "MCP" > "Add new global MCP server". Add to `.cursor/mcp.json`:

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

</details>

<details>
<summary><strong>VS Code</strong></summary>

Add to `.vscode/mcp.json`:

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

</details>

<details>
<summary><strong>Streamable HTTP (Remote / Hosted)</strong></summary>

Run the MCP server as an HTTP service that clients connect to via URL:

```bash
# Start HTTP server on port 3100
npx -y omophub-mcp --transport=http --port=3100 --api-key=oh_your_key_here

# MCP endpoint: http://localhost:3100/mcp
# Health check:  http://localhost:3100/health
```

Connect MCP clients to the `/mcp` endpoint. Useful for centralized deployments where multiple AI agents share one server instance.

</details>

<details>
<summary><strong>Docker</strong></summary>

```bash
# HTTP mode (default in Docker) — serves MCP on port 3100
docker run -e OMOPHUB_API_KEY=oh_your_key_here -p 3100:3100 omophub/omophub-mcp

# Stdio mode (for piping)
docker run -i -e OMOPHUB_API_KEY=oh_your_key_here omophub/omophub-mcp --transport=stdio
```

</details>

### 3. Start Asking

> "What's the OMOP concept ID for type 2 diabetes?"

> "Map ICD-10 code E11.9 to SNOMED"

> "Show me all descendants of Diabetes mellitus in SNOMED"

---

## Available Tools

| Tool | What it does |
| :--- | :--- |
| `search_concepts` | Search for medical concepts by name or clinical term across all vocabularies |
| `get_concept` | Get detailed info about a specific OMOP concept by `concept_id` |
| `get_concept_by_code` | Look up a concept using a vocabulary-specific code (e.g., ICD-10 `E11.9`) |
| `map_concept` | Map a concept to equivalent concepts in other vocabularies |
| `get_hierarchy` | Navigate concept hierarchy - ancestors, descendants, or both |
| `list_vocabularies` | List available medical vocabularies with statistics |

### Resources

| URI | Description |
| :--- | :--- |
| `omophub://vocabularies` | Full vocabulary catalog with statistics |
| `omophub://vocabularies/{vocabulary_id}` | Details for a specific vocabulary |

### Prompts

| Prompt | Description |
| :--- | :--- |
| `phenotype-concept-set` | Guided workflow to build a concept set for a clinical phenotype |
| `code-lookup` | Look up and validate a medical code with mappings and hierarchy |

---

## Example Prompts

**Find a concept →** `search_concepts`
> "Search for metformin in RxNorm"

**Cross-vocabulary mapping →** `map_concept`
> "I have SNOMED concept 201826 - what's the ICD-10 code?"

**Build a concept set →** `search_concepts` → `get_hierarchy` → `map_concept`
> "Help me build a concept set for Type 2 diabetes including all descendants"

**Validate a code →** `get_concept_by_code` → `map_concept`
> "Is ICD-10 code E11.9 valid? What does it map to in SNOMED?"

---

## Configuration

### Environment Variables

| Variable | Required | Description |
| :--- | :---: | :--- |
| `OMOPHUB_API_KEY` | ✅ | Your OMOPHub API key |
| `OMOPHUB_BASE_URL` | | Custom API base URL (default: `https://api.omophub.com/v1`) |
| `OMOPHUB_LOG_LEVEL` | | `debug` · `info` · `warn` · `error` (default: `info`) |
| `OMOPHUB_ANALYTICS_OPTOUT` | | Set to `true` to disable analytics headers |
| `MCP_TRANSPORT` | | `stdio` (default) or `http` |
| `MCP_PORT` | | HTTP server port (default: `3100`, only used with `http` transport) |
| `HEALTH_PORT` | | Port for standalone health endpoint in stdio mode (default: disabled) |

### CLI Arguments

```bash
# Stdio mode (default)
npx omophub-mcp --api-key=oh_your_key --base-url=https://custom.api.com/v1

# HTTP mode
npx omophub-mcp --transport=http --port=3100 --api-key=oh_your_key

# Stdio mode with standalone health endpoint
npx omophub-mcp --api-key=oh_your_key --health-port=8080
```

### Health Endpoint (Docker / Kubernetes)

In **HTTP mode**, the health endpoint is available at `/health` on the same port as the MCP endpoint:

```bash
npx omophub-mcp --transport=http --port=3100 --api-key=oh_your_key
curl http://localhost:3100/health
# → {"status":"ok","version":"1.0.0","uptime_seconds":42}
```

In **stdio mode**, use `--health-port` for a standalone health endpoint:

```bash
HEALTH_PORT=8080 OMOPHUB_API_KEY=oh_your_key npx omophub-mcp
curl http://localhost:8080/health
```

The Docker image defaults to HTTP mode on port 3100 with health checks built in.

---

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

---

## Troubleshooting

| Error | Solution |
| :--- | :--- |
| `API key required` | Set `OMOPHUB_API_KEY` in your environment or MCP config |
| `Authentication failed` | API key may be invalid or expired - [generate a new one](https://omophub.com/dashboard/api-keys) |
| `Rate limit exceeded` | Automatic retries are built in. For higher limits, [upgrade your plan](https://omophub.com/dashboard/billing) |
| Tools not appearing | Restart your AI client, verify `npx omophub-mcp` runs without errors, check config path |

---

## Links

- [Documentation](https://docs.omophub.com)
- [Get an API Key](https://omophub.com/dashboard/api-keys)
- [Python SDK](https://github.com/OMOPHub/omophub-python)
- [Community & Support](https://github.com/OMOPHub/omophub-mcp/issues)

---

## License

MIT - see [LICENSE](LICENSE)
