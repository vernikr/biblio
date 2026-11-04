# Architecture

One page: how a call travels, where things live, and the three rules that must not break.
Read `AGENTS.md` for the verification commands and the checklists for adding a mirror,
provider or tool.

## Request flow

```text
MCP client ──stdio──> src/index.ts       startup self-test, then bind the server
                        └─ src/server.ts  one McpServer, the tools, readable argument errors
                             │
   ┌─────────────────────────┼──────────────────────────┐
   │ lookups                 │ downloads                │ configuration
   ▼                         ▼                          ▼
src/providers/index.ts   src/acquire.ts            src/mirrors.ts   mirror lists, identity markers
   └─ providers/*.ts        ├─ src/http.ts  downloadToFile    src/config.ts    every BIBLIO_* setting
        one module per      └─ src/sniff.ts real format        src/toolmeta.ts  description + example
        source, HTML ->        from the bytes, not the URL
        Book | Paper
   └─ src/http.ts  fetchFromMirrors: race, stagger, cooldown, identity check
        └─ src/providers/circuit.ts   per-source breaker
   └─ src/parse.ts  fields from the right column, useless links dropped
   └─ src/cache.ts  short-lived caches for repeated lookups
```

Lookups return structured data and keep nothing on disk. Downloads stream bytes
straight to a staging file, hashing as they go, and never hold a whole book in
memory. Every network hop goes through `fetchFromMirrors`, which is why the
mirror rules below hold everywhere at once.

## Startup

`src/index.ts` runs `src/selfcheck.ts` before it binds stdio: it makes one real
tool call through the SDK and refuses to start when that fails, naming the fix.
`BIBLIO_SKIP_STARTUP_CHECK=1` bypasses it. `scripts/preflight.mjs` is the
offline dependency guard, run before the build and again after it.

## Module map

| Path | Lives here |
|---|---|
| `src/index.ts` | CLI: server, `--selfcheck`, `--print-config`, `--version` |
| `src/server.ts` | The `McpServer`, tool registration, argument-error translation |
| `src/toolmeta.ts` | `TOOL_META`: each tool's description and call example |
| `src/acquire.ts` | Ranking copies, `saveBook`, `fetchBook`, alternatives on failure |
| `src/providers/` | One module per source; `index.ts` fans out and merges |
| `src/providers/circuit.ts` | Per-source breaker that opens after repeated failures |
| `src/http.ts` | Mirror race, cooldown cache, streaming download, stall watchdog |
| `src/mirrors.ts` | Default mirrors, identity markers, `BIBLIO_*` overrides |
| `src/parse.ts` | Field parsers and the link filters |
| `src/sniff.ts` | Container format from the first bytes |
| `src/cache.ts` | TTL cache for repeated lookups |
| `src/config.ts` | `ENV_SETTINGS` / `NUMBER_SETTINGS` — every setting, read once |
| `src/selfcheck.ts` | Stages behind `--selfcheck` and the startup self-test |
| `src/printConfig.ts` | The npx launcher entry for `--print-config` |
| `scripts/preflight.mjs` | Offline dependency guard |
| `scripts/install.mjs` | Checkout installer: check, install, build, verify, config |

## Three invariants

1. **A mirror is believed only after an identity check.** A 200 is not proof that
   the host is still the site we asked for. Each group declares a marker in
   `src/mirrors.ts`; providers may add a stricter validator of their own.
2. **HTML is never saved as a book.** `downloadToFile` raises
   `HtmlInsteadOfFileError` when a "direct" URL serves a page instead of a file,
   and `saveBook` moves on to the next candidate rather than writing it. The file
   name comes from `src/sniff.ts`, not from the URL.
3. **A file the caller named is never overwritten.** `saveBook` publishes with
   `link`, which is atomic and refuses an existing name; the refusal is reported,
   never retried under a different name.

## Conventions worth knowing before you edit

- Diagnostics go to stderr. Stdout is JSON-RPC on a live server and JSON only
  under `--print-config`.
- Mirror lists are read when the module is imported, so a test that overrides
  them must set the environment before importing `dist/`.
- Every `BIBLIO_*` setting is declared once in `src/config.ts`; the README table
  is generated from it by `pnpm run docs:env`.
- A new behaviour test should fail on the previous code.
