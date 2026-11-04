# CLI implementation

## Scope

Implemented step 3 of Issue #1: an eight-command CLI that calls the shared application layer directly. The no-argument entry point remains the MCP stdio server.

## Commands

- `search books <query>`
- `book details <md5>`
- `book links <md5>`
- `download book <md5>`
- `fetch book <query>`
- `search papers <query>`
- `paper get <identifier>`
- `healthcheck`

The CLI supports `--json`, source selection, search limits, output directory and filename, format, download attempts, optional PDF resolution, and healthcheck timeout. It validates arguments, rejects unknown options and extra positional arguments, prints results to stdout, and sends diagnostics/download progress to stderr. Exit codes: 0 success, 1 operation-level failure, 2 invalid CLI input.

## Implementation

- Added `src/cli.ts` for parsing, validation, dispatch, human-readable/JSON output, progress and exit codes.
- Updated `src/index.ts` to route CLI commands before startup self-test and MCP transport creation.
- Reused the shared Zod constraints and all eight application functions; no MCP server/client is started for CLI commands.
- Added four CLI adapter tests.
- Documented command usage in README and the module map in architecture docs.

## Verification

- `pnpm run build`: passed.
- `node --test test/cli.test.mjs`: 4/4 passed.
- `pnpm run selfcheck:offline`: passed; all eight MCP tools remain available.
- `pnpm run verify`: 261/269 passed. The same eight installer/preflight fixture tests remain failing as before this CLI step; failures are in subprocess fixture output / dependency-pair preflight tests. All four newly added CLI tests passed.
