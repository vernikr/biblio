# Wave 1 — volume and CI, mechanical pass

Scope: the bucket A/C/D tasks from the refactor plan that cannot change
behaviour in a way the suite would notice, plus the new "de-guard the docs" workstream.

Six commits on top of `be30d4b` (2.2.5).

## Done

| Task | Change |
|---|---|
| A4 | 8 dead exports removed; `stableExecDir` deleted with the two tests that only guarded it |
| A5 | `linkAbortSignals` returns `AbortSignal.any` directly; the unreachable manual fallback and every `dispose()` call site are gone |
| A6 | `src/errors.ts: errText()` replaces 6 copies of the error-to-string pattern |
| D2 | `TOOL_NAMES` derived from `TOOL_META`; `selfcheck` and `test/server.test.mjs` both read it |
| D3 | `resolveDownloadReport` normalises the md5 once; `libgen.details` reports the normalised hash |
| D7 | `shouldQueryAnnasHtml()` deleted; the skip reason is computed once |
| G1 | Counters removed from README/AGENTS/STATE/decisions; two env guards merged into one; the changelog guard trimmed; the fork-scope guard deleted |
| C7 | `concurrency:` cancels superseded runs |
| C8 | `verify` compiles once instead of twice |
| C3 | Test workers scale with the machine, clamped to [2, 8] |

## Rejected after investigation

- **A8 (one in-memory MCP client helper).** Looks like 12 duplicated lines; it is not.
  6 of the 10 test files that use `withMcpClient` set `BIBLIO_*` environment variables
  *before* importing built modules, because mirror lists are read at module load.
  A helper living in `src/` would pull the provider graph in at import time and break
  all six. The duplication stays; the constraint is now worth recording.
- **D3 was downgraded, not fixed as a live bug.** Every tool entry point already
  lower-cased the md5, so no caller could observe the inconsistency. The change is
  defensive: it removes the trap, it does not fix a defect.

## Measured

| | Before | After |
|---|---|---|
| Offline suite | 19.4 s | 15.4 s (232 tests, 0 skips) |
| `pnpm run verify` | ≈ 22 s | 17.3 s |
| Unused exports in `src/` (knip) | 10 values | 0 |
| Copies of the tool-name list | 3 | 1 |

The remaining suite time is `install.test.mjs` at 10.4 s — unchanged, and the subject
of C1 in the next wave.

## Regression checks (each must fail on the previous code)

- Adding `process.env.BIBLIO_NOT_REGISTERED` to `src/` fails the new env-settings guard.
- Deleting `fetch_book` from `TOOL_META` fails the `--selfcheck` tools stage. On the
  previous code it passed, because the hand-written list had only 7 of 8 tools.

## Full gate, clean checkout

```
pnpm install --frozen-lockfile   ok
pnpm run preflight               ok   (5/5)
pnpm run verify                  ok   232 pass / 0 fail / 0 skipped, selfcheck green
node scripts/install.mjs --dry-run   ok
node --test <5 floor files>      ok
startup guard vs broken pairing  ok   (refuses, exit 1, names the fix)
```
Total 19.9 s including install.
