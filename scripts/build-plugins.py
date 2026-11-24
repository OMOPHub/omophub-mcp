"""Build local review bundles from a fixed list of distributable files."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
from shutil import copyfile, copytree

root = Path(__file__).resolve().parents[1]
out = root / "build/plugins"
common = {
    "skills/omophub/SKILL.md": "skills/omophub/SKILL.md",
    "assets/icon.png": "plugins/assets/icon.png",
    "LICENSE": "LICENSE",
    "README.md": "plugins/README.md",
}
layouts = {
    "openai": {
        "plugin.json": "plugins/openai/plugin.json",
        "mcp.json": "plugins/openai/mcp.json",
        "README.md": "plugins/openai/README.md",
    },
    "codex": {
        ".codex-plugin/plugin.json": "plugins/codex/.codex-plugin/plugin.json",
        ".mcp.json": "plugins/codex/mcp.json",
        "hooks/hooks.json": "plugins/codex/hooks/hooks.json",
        "hooks/check-hierarchy-page.mjs": "src/utils/check-hierarchy-page.mjs",
        "hooks/hierarchy-review.mjs": "src/utils/hierarchy-review.mjs",
        "hooks/hierarchy-progress.mjs": "src/utils/hierarchy-progress.mjs",
        "hooks/check-hierarchy-read.mjs": "src/utils/check-hierarchy-read.mjs",
        "hooks/check-hierarchy-reply.mjs": "src/utils/check-hierarchy-reply.mjs",
        "hooks/mapping-review.mjs": "src/utils/mapping-review.mjs",
        "hooks/review-state.mjs": "src/utils/review-state.mjs",
        "hooks/check-verified-search.mjs": "src/utils/check-verified-search.mjs",
        "hooks/check-search-result.mjs": "src/utils/check-search-result.mjs",
        "hooks/check-mapping-result.mjs": "src/utils/check-mapping-result.mjs",
        "hooks/coding-review.mjs": "src/utils/coding-review.mjs",
        "hooks/check-coding.mjs": "src/utils/check-coding.mjs",
        "hooks/exact-code.mjs": "src/utils/exact-code.mjs",
        "hooks/check-prompt.mjs": "src/utils/check-prompt.mjs",
        "hooks/terminology-scope.mjs": "src/utils/terminology-scope.mjs",
        "hooks/record-fields.mjs": "src/utils/record-fields.mjs",
    },
    "claude": {
        "README.md": "plugins/claude/README.md",
        ".claude-plugin/plugin.json": "plugins/claude/.claude-plugin/plugin.json",
        ".mcp.json": "plugins/claude/mcp.json",
        "hooks/hooks.json": "plugins/claude/hooks/hooks.json",
        "hooks/exact-code.mjs": "src/utils/exact-code.mjs",
        "hooks/mapping-review.mjs": "src/utils/mapping-review.mjs",
        "hooks/review-state.mjs": "src/utils/review-state.mjs",
        "hooks/hierarchy-review.mjs": "src/utils/hierarchy-review.mjs",
        "hooks/hierarchy-progress.mjs": "src/utils/hierarchy-progress.mjs",
        "hooks/coding-review.mjs": "src/utils/coding-review.mjs",
        "hooks/claude-coding.mjs": "src/utils/claude-coding.mjs",
        "hooks/claude-hierarchy.mjs": "src/utils/claude-hierarchy.mjs",
        "hooks/claude-record-input.mjs": "src/utils/claude-record-input.mjs",
        "hooks/claude-review.mjs": "src/utils/claude-review.mjs",
        "hooks/claude-mapping.mjs": "src/utils/claude-mapping.mjs",
        "hooks/claude-verified-search.mjs": "src/utils/claude-verified-search.mjs",
        "hooks/check-verified-search.mjs": "src/utils/check-verified-search.mjs",
        "hooks/terminology-scope.mjs": "src/utils/terminology-scope.mjs",
        "hooks/record-fields.mjs": "src/utils/record-fields.mjs",
        "hooks/claude-exact-code.mjs": "src/utils/claude-exact-code.mjs",
    },
}
catalogs = {
    ".agents/plugins/marketplace.json": {
        "name": "omophub-pilot",
        "interface": {"displayName": "OMOPHub local pilot"},
        "plugins": [{"name": "omophub", "source": {"source": "local", "path": "./codex/omophub"},
                     "category": "Research", "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"}}],
    },
    ".claude-plugin/marketplace.json": {
        "name": "omophub-pilot", "owner": {"name": "OMOPHub"},
        "metadata": {"description": "Local OMOPHub terminology pilot"},
        "plugins": [{"name": "omophub", "source": "./claude/omophub"}],
    },
}

# Build the ZIP from the allowlist, including when the output directory already exists.
with TemporaryDirectory() as temp:
    stage = Path(temp)
    for host, manifests in layouts.items():
        bundle = stage / host / "omophub"
        for target, source in {**common, **manifests}.items():
            path = bundle / target
            path.parent.mkdir(parents=True, exist_ok=True)
            copyfile(root / source, path)
    for relative, catalog in catalogs.items():
        path = stage / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    with ZipFile(stage / "omophub-openai.zip", "w") as archive:
        for name in sorted({**common, **layouts["openai"]}):
            entry = ZipInfo(name)
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, (stage / "openai/omophub" / name).read_bytes(), ZIP_DEFLATED)
    if out.exists():
        extras = {p.relative_to(out) for p in out.rglob("*")} - {p.relative_to(stage) for p in stage.rglob("*")}
        if extras:
            raise SystemExit("Unexpected files in build/plugins. Move them before rebuilding.")
    copytree(stage, out, dirs_exist_ok=True)
print(f"Built local review packages in {out}")
