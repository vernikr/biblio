# Project state

**Start with [`AGENTS.md`](../AGENTS.md).** Review evidence, stage reports, patches, snapshots,
audit logs and release receipts are archived under `docs/worklog/archive/`; they are historical
checkpoints, not the current roadmap.

## Release and support

- Public npm: [`@vernikr/biblio-mcp`](https://www.npmjs.com/package/@vernikr/biblio-mcp); the current
  version is the one in `package.json`. Cold npx and pnpm registry launchers pass.
- Releases, with their `.tgz`, `.mcpb` and checksums, are on the
  [releases page](https://github.com/vernikr/biblio-mcp/releases).
- Node **22+**, pnpm **12.10.1** for maintainers; CI covers 22/24 and exact 22.0.0.
- npm/MCPB use the same compiled stdio runtime. MCPB carries locked production dependencies;
  consumer checkout/TypeScript/build tools are not required. Source installer remains a developer utility.
- Desktop GUI installation is not claimed; archive/runtime acceptance covers Linux/macOS/Windows.

## Verification

```bash
pnpm install --frozen-lockfile
pnpm run verify                       # offline, one top-level build, no live mirrors
pnpm run package:verify               # archives + consumer acceptance; registry access may be needed
node scripts/check-artifacts.mjs --registry  # actual public launchers, only for a published version
pnpm run docs:env                     # fresh compiled environment table
pnpm run verify:live                  # optional live diagnostics, separate from offline gate
```

The offline suite passes without skips; pnpm must be on PATH and its store primed for the clean
installer fixtures. The cost of genuine install/build tests is kept
rather than dropping coverage to hit an obsolete under-five-second target.

## Next code work

Iteration 1 of the refactor is closed: five waves, reports archived under
`docs/worklog/archive/2026.10.10-refactor-wave1…5/`. It de-duplicated `src/`, cut the tracked tree
from 15 MB to 2.1 MB, moved the maintainer half of the README into `AGENTS.md` and
`docs/architecture.md`, and fixed the behaviour findings listed below.

Iteration 2 has four waves. Wave 1 (one definition per fact: the source list, the argument-error
extractor, the anchor pass, the pinned versions, file-type sniffing; 2.2.7), wave 2 (measured
hardening: one Sci-Hub resolution for the short agent loop, a 20 MB budget on mirror page bodies;
2.2.8) wave 3 (facts that stay true: the last hand-written dependency version, and a mirror
registry that no longer claims measurements it cannot keep; 2.2.9) and wave 4 (a download attempt
gives up after the same half-minute of silence whether it is waiting for headers or for bytes;
2.2.10) are done and released; their reports and measurements are archived in
[`docs/worklog/archive/2026.10.11-refactor-iteration2/`](archive/2026.10.11-refactor-iteration2/).

Iteration 2 is closed: the plan holds no scheduled row — everything is delivered or carries a
"do not re-propose" note, and the suite and README line targets were retired after measuring them.
The next piece of work starts from new evidence — a live probe that contradicts a file in the tree
(wave 3 found one that way), a report from an agent using the tools, or an observed failure — not
from a re-check of what is already closed.

Closed by iteration 1, so nobody re-opens them:

- `fetch_book` re-ran a full source search on every failed copy; it now reuses the ranked
  candidate list it already holds.
- `get_download_links` reported a source as unavailable while that same source supplied links.
- Sci-Hub parsed each mirror's page twice; `scihub.resolve` went from 57–65 ms to 27–28 ms.
- Two findings were built, measured and deliberately reverted: Libgen row serialisation and the
  per-chunk stall timer. Both are recorded with their measurements in the draft plan.

Cached Anna detail pages remain intentionally deferred because loser cancellation is more useful.

## Preserved limits and safety

- Member fast-download key goes only to identity-verified hosts; never commit it.
- Human-verification pages are reported, never solved or saved as books; Z-Library stays off by default.
- Explicit filenames never overwrite; filesystems without hard-link support fail safely.
- Production audit is clean. A dev-only node-forge RSA verification advisory remains in MCPB CLI;
  signing/verification is not used, bundles are unsigned, the library is not shipped to consumers.
- Mirror availability changes independently of code; optional live CI is non-blocking.
