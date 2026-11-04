# Maintainer and coding-agent guide

This repository uses the approved separate fork identity, `@vernikr/biblio-mcp`. Use Node.js 22+ and pnpm;
keep changes testable without live access to shadow-library mirrors.
CI checks Node 22/24 LTS and the exact 22.0 runtime floor.

## Current state

- Published on npm as `@vernikr/biblio-mcp`; the current version is the one in `package.json`.
- `docs/architecture.md` — request flow, module map, the three invariants.
- `docs/STATE.md` — what is released, verified, and what the next code task is.
- `docs/decisions.md` — why the non-obvious behaviour is the way it is.
- `docs/worklog/` — reports for work in progress; closed tasks move to `docs/worklog/archive/`.
  Nothing there is current instruction: an archived report described its own day.

## Verification

```bash
git clone https://github.com/vernikr/biblio-mcp.git
cd biblio-mcp
pnpm install --frozen-lockfile
pnpm run verify
```

Node 22 or 24 LTS; CI also checks the exact Node 22.0 runtime floor. Maintainers use pnpm and
the committed lockfile; consumers need neither this checkout nor a compiler.

| Script | What it does |
|---|---|
| `pnpm run dev` | run from source via tsx |
| `pnpm run typecheck` | strict checks for `src/` |
| `pnpm run build` | compile to `dist/` |
| `pnpm run test` | offline suite only (builds first) |
| `pnpm run test:live` | optional live mirror/provider checks |
| `pnpm run preflight` | offline install/dependency check (before or after build) |
| `pnpm run preflight:strict` | ...and fail if `dist/` is missing |
| `pnpm run selfcheck` | tools + mirror reachability with timings |
| `pnpm run selfcheck:live` | ...plus one real search |
| `pnpm run verify` | typecheck + one build + offline suite + offline selfcheck |
| `pnpm run verify:live` | ...then mirrors and a real search |
| `pnpm run docs:env` | rebuild and synchronize the README environment table |
| `pnpm run fixtures:capture` | refresh the verified provider-page fixtures (uses the network) |
| `pnpm run benchmark` | opt-in live provider timing (before/after comparison) |
| `pnpm run package:artifacts` | one build, npm tarball + MCPB |
| `pnpm run package:verify` | offline gate, then archive/consumer acceptance |

`scripts/install.mjs` is a **source-checkout utility**, not the consumer install path: it
installs locked dependencies, builds and runs the offline selfcheck. `--write-config <path>`
validates and merges client config with a backup; `--dry-run` writes nothing; `--live` adds
mirror/search checks. It is not shipped in the consumer tarball.

Design rationale is in [`docs/decisions.md`](docs/decisions.md); the closed audit is in
[`docs/worklog/archive/2026.10.08-audit/`](docs/worklog/archive/2026.10.08-audit/).

Default verification needs no live mirrors. `pnpm run test` also builds independently; for one
file, build first. Optional mirror tests are under `test/live/` (`pnpm run test:live`) and remain
outside the default suite. Stdio integration checks actual SDK responses, including a rejected
invalid call; merely starting the process or grepping a tools list is not verification.

Running tests:

- Installer write-path tests start without `node_modules`/`dist` and run real dependency
  installation and builds, so they dominate the suite's runtime.
- Installer tests that need pnpm are reported as skipped when it is absent from `PATH`. Run
  `pnpm install --frozen-lockfile` once to prime the store; clean fixtures install in offline mode.
- Servers that stand in for mirrors start with `listenLocal` and stop with `closeServer` from
  `test/helpers/mirror-server.mjs`. `closeServer` drops keep-alive sockets first, which keeps the
  suite from waiting on idle connections.
- A new behaviour test should fail on the previous code. Check this by stashing `src/` and running
  the new test.

## Updating mirrors

- Edit the defaults and `MIRROR_GROUPS` identity markers in `src/mirrors.ts`; environment overrides
  are parsed there as well.
- A status code is not proof that a host is the expected site. Check the returned content, update
  the group's identity marker, and run `pnpm run selfcheck` before changing preference order.
- Provider fetch validation is per-provider. Anna's scraped pages have an identity validator; the
  Sci-Hub ALTCHA pages (HTTP 200) are rejected by the provider validator, so the next mirror is
  tried; the server never attempts to solve the check (A16 in
`docs/worklog/archive/2026.10.08-audit/`).
- Keep unreachable domains only when they may recover or are useful as user-configurable fallbacks;
  explain non-obvious ordering in `docs/decisions.md`.

## Adding or changing a provider

1. Implement the provider under `src/providers/` and return the shared `Book` or `Paper` shape from
   `src/types.ts`.
2. Reuse `fetchFromMirrors` from `src/http.ts` and validators in `src/parse.ts`; avoid positional
   field guesses when the page exposes headers.
3. Register the provider in `src/providers/index.ts`. If it is a new source, also update `SourceId`,
   default/disabled source handling, the relevant Zod schema and description in `src/server.ts`,
   and the tool examples/tests. The Zod argument schema lives in `src/server.ts`; the description and example live in `src/toolmeta.ts`.
4. Add regression tests against a local HTTP server or captured markup. Environment variables that
   define mirror lists are read at module import time; set them before importing built modules (use
   a child process when the test needs an isolated provider graph).
5. Run the offline checks above and inspect the full diff before committing.

## Settings and tool descriptions

- Every `BIBLIO_*` setting is listed once in `ENV_SETTINGS` in `src/config.ts`. Numeric budgets are
  read through `readNumber(NUMBER_SETTINGS.…)`, so a default is written in one place. After changing
  the list, run `pnpm run docs:env` to rewrite the README table.
- Each tool's description and call example live together in `TOOL_META` in `src/toolmeta.ts`.
  `test/tool-meta.test.mjs` checks each example against the tool's input schema, so an example that
  no longer matches the schema fails the suite. Argument descriptions stay in the Zod schemas.

## Capturing HTML fixtures

- `pnpm run fixtures:capture` contacts configured public sites and refreshes the supported real
  captures in `test/fixtures/`. It checks HTTP status, expected content markers, challenge pages,
  and response size before replacing a fixture.
- Only commit genuine, reviewable provider responses; do not handcraft substitute HTML for a site
  that is unavailable. Anna's Archive and Z-Library are intentionally absent from the capture list
  while their pages cannot be captured reliably.
- After a capture, update the SHA-256 entry and semantic assertions in `test/fixtures.test.mjs`,
  then run `pnpm run test`.

## README cover

The text between `<!-- cover:start -->` and `<!-- cover:end -->` in `README.md` is the
user-facing summary of what this fork gives people. It is written for end users, in plain
language, without implementation detail. Update it in the same commit whenever a change alters
what a user gets (a new benefit, a removed limitation, a changed default), and keep it short.

## Releasing

1. Bump `package.json` (SemVer) and write the `CHANGELOG.md` entry under the new version, with its
   compare link; commit both as `release: X.Y.Z`.
2. Green full gate on `main` (CI runs `build` ×2, `artifacts` ×3 OS, `live`).
3. `pnpm run package:verify` builds the `.tgz`/`.mcpb`/`SHA256SUMS` into ignored `artifacts/` and
   exercises real consumers.
4. Tag `vX.Y.Z` on the release commit; publish a GitHub release carrying the tarball, the `.mcpb`
   and `SHA256SUMS`.
5. `npm publish <absolute path to the tested .tgz>` — publish the bytes that were tested, not a
   fresh pack. Then `node scripts/check-artifacts.mjs --registry` once the registry serves the new
   version, which is the only check that exercises the public launchers.

## Packaging and credentials

- The user approved npm name `@vernikr/biblio-mcp` and Node 22+. Never publish under upstream's
  `biblio-mcp` name. Registry publication still requires authenticated scope rights; do not
  describe a prepared archive as already published. Version 2.0.0 is now public; never republish
  different bytes under that immutable version. Publish only tested tarballs after
  verifying scope rights; registry authentication/trusted publishing is separate from GitHub PATs.
- `pnpm run package:verify` runs the offline gate once, then builds `.tgz`/`.mcpb` and checks real
  consumer launches outside checkout. Packaging/consumer dependency installation may use npm's
  registry, not live mirrors. Artifacts are generated under ignored `artifacts/`.
- npm ships `dist` and plain-JS preflight. MCPB uses the same runtime and hoisted locked production
  dependencies: a symlink-based virtual store loses dependency resolution when flattened into ZIP.
- The source installer remains a checkout utility, not the default consumer installation path.
- MCPB artifacts are unsigned. The CLI has a dev-only unpatched node-forge signature-verification
  advisory (GHSA-86w9-cpqp-85rv); do not use its signing/verification commands as a trust boundary.
  It is not shipped as a runtime dependency. Patched `tmp` is pinned for its prompt dependency.
- Never commit PATs, API keys, user config, dependency trees or generated archives. Keep
  `BIBLIO_ANNAS_API_KEY` in runtime settings; use temporary credentials for Git pushes.

## Contributing

Parser fixes when sites change their HTML are the most welcome PRs. The most common maintenance
task is updating [`src/mirrors.ts`](src/mirrors.ts) when domains rotate; run `pnpm selfcheck`
first, since it measures every host and prints the timings you need to order them.

Two rules this fork holds to:

1. **A red build must mean "something regressed", not "something we already know about."**
   Known-bad behaviour is pinned with `todo` tests that describe the intended fix.
2. **CI must be able to tell a working server from one that merely starts.** The offline
   integration suite sends a real `tools/call` over an in-memory transport, because
   `tools/list` succeeds even on a build that cannot serve a single request.
