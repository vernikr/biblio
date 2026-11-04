# CLI discovery: existing MCP contract

Date: 2026-11-05  
Scope: Issue #1, implementation plan step 1 (inspect and map current behavior).

## Current execution path

- `src/index.ts` is the package binary entry point (`package.json` maps `biblio-mcp` to `dist/index.js`). It handles `--help`, `--version`, `--print-config`, `--selfcheck`, and otherwise starts the MCP stdio server.
- With no arguments, `index.ts` runs `runStartupSelftest()` unless `BIBLIO_SKIP_STARTUP_CHECK` is set, creates `McpServer`, connects `StdioServerTransport`, and writes readiness diagnostics to stderr.
- `src/server.ts` owns the eight MCP registrations, their inline Zod argument schemas, annotations, handler orchestration, MCP progress notifications, and conversion of results to MCP text content.
- `src/toolmeta.ts` owns tool descriptions/examples and the shared ordered tool-name list. It also translates Zod validation issues into agent-readable messages.
- Provider/business logic is already mostly outside the MCP adapter: `src/providers/index.ts`, `src/providers/*.ts`, `src/acquire.ts`, `src/mirrors.ts`.
- `src/selfcheck.ts` calls tools through an MCP client; it is a verification path, not reusable business logic.

## Tool contract and direct implementation mapping

| MCP tool | Current input contract | Defaults / normalization | Existing implementation to reuse | Result and failure semantics |
|---|---|---|---|---|
| `search_books` | `query`: trimmed non-empty string; `sources`: optional non-empty array of `annas`, `libgen`, `zlibrary`; `limit`: optional integer 1–100 | Sources default to `BOOK_SOURCES` (currently Anna's Archive + Libgen; Z-Library disabled by default); duplicates removed. Limit 20. | `searchBooks(query, selectedSources, limit)` in `providers/index.ts` | Structured search object plus `total` and `sourcesSearched`. Per-source failures are returned in `errors`; they do not fail the whole search. |
| `book_details` | `md5`: 32 hexadecimal characters | Hash lowercased. | `bookDetails(md5)` in `providers/index.ts` | Book details object. Missing usable title is an MCP error (`isError: true`) while retaining the details/failure fields in the body. |
| `get_download_links` | `md5`: 32 hexadecimal characters | Hash lowercased. | `resolveDownloadReport(md5)` in `providers/index.ts` | Object with `md5`, `count`, `links`, optional `notFound` and `errors`. Any links means success. Zero links plus source errors is an MCP error; zero links with all sources answering is a successful “no link” result. |
| `download_book` | `md5`: 32 hex; optional `output_dir`: non-empty string; optional `filename`: string | Hash lowercased. Output defaults to `defaultOutputDir()` = `~/Downloads/biblio-mcp`; relative paths resolve from home. Filename is validated as a plain name before network work. | `saveBook(hash, SaveRequest)` in `acquire.ts`; `defaultOutputDir()` | `SaveOutcome.body` returned as structured result. `saved: false` is an MCP error. Progress and abort signal currently come from MCP request context. |
| `fetch_book` | `query`: trimmed non-empty string; optional `format`: non-empty string; optional `output_dir`: non-empty string; optional `max_attempts`: integer 1–5; optional `sources`: non-empty array of book source IDs | Output defaults to `defaultOutputDir()`; max attempts 3; sources default to `BOOK_SOURCES`; internal search limit 20. | `fetchBook(FetchBookArgs)` in `acquire.ts` | Structured outcome with `saved`, `picked`, `attempts`, and actionable failure fields. `saved: false` is an MCP error. Progress and abort signal currently come from MCP request context. |
| `search_papers` | `query`: trimmed non-empty string; optional `limit`: integer 1–100; optional `resolvePdfs`: boolean | Limit 20; PDF enrichment off by default. | `libgen.searchPapers(query, limit)` under `withSourceCircuit("libgen", ...)`; optional `resolvePaperPdfs(papers)` in `server.ts` | Object `{ query, total, results }`. Optional Sci-Hub enrichment is best-effort and limited to three DOI-bearing results; failures do not fail the search. |
| `get_paper` | `identifier`: trimmed non-empty string (DOI, article URL, or title) | No additional default. | `scihub.resolve(identifier)` under `withSourceCircuit("scihub", ...)` | Structured resolver result; provider errors currently propagate through MCP as tool-call errors. |
| `healthcheck` | optional `timeoutMs`: integer 250–30000 | Default 8000 ms. Clears dead-mirror cache before probing. | `resetDeadCache()`, `MIRROR_GROUPS`, `probeGroup()`, `toHealthcheckGroup()` in `mirrors.ts` | Object with version, ready, reachable/unreachable groups, impostors, source defaults, and per-group probe details. A completed probe report is returned even when no mirror is reachable; `ready` carries the status. |

## Shared-layer boundaries and MCP-specific coupling

### Already reusable

- Book aggregation, source selection and per-source error capture: `providers/index.ts`.
- Book metadata lookup and download-link resolution: `providers/index.ts`.
- Download orchestration, file validation, collision handling, alternatives and ranking: `acquire.ts`.
- Paper providers and circuit-breaker wrapper: `providers/libgen.ts`, `providers/scihub.ts`, `providers/circuit.ts`.
- Mirror health probing and result normalization: `mirrors.ts`.
- Default output directory: `acquire.ts`.
- Shared source IDs and data types: `types.ts`.

### Logic currently embedded in `server.ts` and likely to extract

- Input schemas and normalization: `md5Schema`, `searchTextSchema`, source de-duplication, default limits and lowercase hashes.
- Result assembly for `search_books`, `get_download_links`, `search_papers`, and `healthcheck`.
- Success/failure classification for `book_details`, `get_download_links`, `download_book`, and `fetch_book`.
- `plainFileName()` validation currently runs in the MCP adapter before calling `saveBook`; it should become a shared application-level validation rule so CLI and MCP agree.
- `resolvePaperPdfs()` is currently exported from the MCP server module even though it is provider/application behavior; move it to a non-transport module before the CLI depends on it.

### Transport-specific concerns to keep in the adapters

- `makeProgressReporter()` sends MCP `notifications/progress`; shared download logic should continue to accept a generic progress callback and AbortSignal, while the CLI adapter supplies terminal progress reporting and its own AbortSignal lifecycle.
- `json()` / `jsonError()` wrap values in MCP `content[].text` and set MCP `isError`. The application layer should return plain typed values plus an explicit outcome/status; MCP maps those to MCP result envelopes and CLI maps them to stdout/stderr and exit codes.
- `useReadableValidationErrors()` patches SDK validation and should remain MCP-only. The CLI needs its own argument parser/validation path, ideally sharing schema definitions rather than reproducing constraints.
- `createServer()`, `StdioServerTransport`, startup self-test and JSON-RPC framing are MCP runtime concerns. CLI command dispatch must bypass them.
- Existing `--selfcheck`, `--print-config`, `--version` and `--help` are entry-point options and must remain compatible when adding subcommands.

## Validation and test coverage already present

- `test/server.test.mjs`: tool set, schemas, defaults, source enum, argument error readability, annotations and version.
- `test/stdio.test.mjs`: real stdio startup, tool listing and invalid-call protocol response; confirms stdout remains valid MCP frames and diagnostics go to stderr.
- `test/tool-meta.test.mjs`: tool descriptions/examples and schema consistency.
- `test/selfcheck.test.mjs`: offline/live selfcheck behavior.
- `test/acquire.test.mjs`, `test/download-*.test.mjs`, `test/providers.test.mjs`, `test/details.test.mjs`, healthcheck-related coverage: underlying business behavior.
- `pnpm run verify` is the repository's offline gate. `pnpm run test` builds before running the test harness.

## Recommended design for step 2

1. Introduce a transport-neutral application module (for example `src/app.ts`) with one typed function per operation. Keep public argument names aligned to the existing MCP schema; map snake_case MCP fields to internal camelCase only at the adapter boundary if needed.
2. Move shared Zod schemas to a neutral schema module (for example `src/schemas.ts`) and use them from both MCP registration and CLI parsing/validation. Keep MCP descriptions/annotations in `server.ts` and `toolmeta.ts`.
3. Have application functions return plain data and an explicit success/failure outcome. They must not import the MCP SDK or create MCP content envelopes.
4. Keep progress as an injected callback and cancellation as an optional AbortSignal. The MCP adapter wraps notifications; the CLI adapter renders progress to stderr.
5. Keep no-argument startup and existing maintenance flags in `index.ts`; route recognized subcommands to CLI dispatch before startup self-test and transport creation.
6. Add adapter-level tests for CLI argument parsing, output streams, JSON validity and exit codes; retain the existing MCP stdio integration tests as the compatibility gate.

## Findings / decisions for the next step

- No second provider implementation is needed: all eight capabilities already have reusable provider or acquisition functions.
- The largest architectural gap is result orchestration and error classification embedded in `server.ts`, plus the MCP-only progress adapter.
- There are eight MCP tools, but the proposed CLI command vocabulary has eight commands and renames `get_paper` to `paper get`, `book_details` to `book details`, etc.; preserve the MCP names and schemas as the compatibility contract.
- `get_download_links` has a meaningful distinction between “no link found” and “source outage”; retain that distinction in both CLI exit behavior and JSON payloads.
- Download commands are side-effecting filesystem operations. Their CLI exit code must reflect `saved`, and progress must stay on stderr so stdout can remain parseable JSON.
- This discovery step changes no runtime behavior. Step 2 should start by extracting shared schemas and application result contracts, then route MCP handlers through them before adding CLI execution.
