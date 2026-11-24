# OMOPHub terminology pilot

These bundles connect to the hosted medical terminology service using OAuth. The ChatGPT directory package has its own version and README. For self-hosted HTTP and local stdio API-key setup, see the [server README](../README.md).

Build from the MCP checkout with `npm run build:plugins` (Python 3). The command writes the native Codex and Claude plugin directories, their local marketplace catalogs, and the OpenAI upload bundle at `build/plugins/omophub-openai.zip`. Validate the Claude bundle with `claude plugin validate --strict build/plugins/claude/omophub`. Pin the reviewed revision when distributing the marketplace.

## Local Codex review

Use Node.js and a dedicated Codex home for OMOPHub. Its prompt hook checks every prompt submitted in that home, including prompts without the OMOPHub skill selected. The hook stops recognized chart fields and explicit requests to choose a medicine before the model can call a tool. It also explains the read-only scope for explicit requests to change synonyms on a vocabulary concept. Existing synonym lookups and code lookups for named medications can proceed. Enter only standalone terminology questions.

Run the following commands from the MCP checkout in a shell dedicated to the pilot.

```sh
pilot_profile="${XDG_DATA_HOME:-$HOME/.local/share}/omophub-codex-pilot"
mkdir -p "$pilot_profile"
CODEX_HOME="$pilot_profile" codex plugin marketplace add "$PWD/build/plugins"
CODEX_HOME="$pilot_profile" codex plugin add omophub@omophub-pilot
CODEX_HOME="$pilot_profile" codex
```

Open `/hooks`, review the installed OMOPHub `UserPromptSubmit`, `PostToolUse`, `Stop` and `PreToolUse` commands and their scripts, and trust them before testing. For requests to follow descendant pages, the first hook guides tool selection. The page hook combines IDs and truncation flags from consecutive successful reads of the same hierarchy. The read hook checks an explicit page size before the request reaches the API. The reply hook can request a missing page, then check the completed reply against the verified IDs and flag. It can request up to three corrections. Duplicate descendant reads after the final page stay local. A failed API read retains its normal error handling. The hooks keep a private per-session file under `CODEX_HOME/omophub-hierarchy` with the turn, numeric IDs and pagination metadata. The file is cleared at turn completion or on the next prompt in that session. For single-Coding requests that ask for the standard OMOP concept and CDM table, the Coding hooks check the supplied fields before the read and check both values against the resolver result. They store the terminology arguments and verified outcome under `CODEX_HOME/omophub-coding` for the turn. If the host omits a post-call event on error, the assistant is prompted to report the resolver’s own error. For a quoted vocabulary search requesting the verified OMOP ID, vocabulary code and release, the native hooks check the search arguments and compare the reply with `verified_concept`. The private turn state under `CODEX_HOME/omophub-verified-search` holds a digest of the term, the vocabulary and the verified identifiers. Fresh installs require this review. Use the same dedicated home for subsequent pilot sessions. The OpenAI upload ZIP and the Claude bundle distribute the terminology skill. The blocking prompt hook is part of the native Codex bundle.

The native Codex MCP configuration requests `vocabulary:read` at `https://mcp.omophub.com/mcp`. The OpenAI upload manifest selects CIMD. Codex exposes an explicit CIMD choice through the per-login `--oauth-client-registration cimd` option.

[Setup documentation](https://docs.omophub.com) · [Support](https://omophub.com/contact) · [Privacy policy](https://omophub.com/privacy-policy) · [Terms](https://omophub.com/terms)
