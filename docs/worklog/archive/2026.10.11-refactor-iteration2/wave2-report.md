# Wave 2 — measured hardening

Second wave of iteration 2. Scope: the two behaviour rows of the draft plan, `E6` and `E5`, each
scheduled only after its evidence cell had been re-checked, plus the two targets wave 1 retired.

Two commits on top of `874ec18` (2.2.7), branch `refactor/iteration2-wave2`.

## E6 — the duplicate resolution was real

The plan required a re-measure first, because iteration 1's `E2` had already halved
`scihub.resolve`. Measured with a local Sci-Hub stub that answers after a deliberate delay —
`search_papers { resolvePdfs: true }` on a DOI, then the follow-up `get_paper` on the DOI that
search just resolved:

| | Before (`874ec18`) | After |
|---|---|---|
| Mirror requests for that one DOI | 2 | 1 |
| Time the follow-up `get_paper` adds | 159 ms (a full round trip) | 1 ms |

The fix copies the provider cache idiom (`adsPageCache` in `libgen.ts`):
`AsyncTtlCache<string, Paper>` with `PROVIDER_CACHE_TTL_MS` (45 s) and 64 entries, keyed by the
trimmed identifier; `scihub.resolve` delegates to an uncached path. Concurrent callers share one
in-flight resolution. A miss is deliberately not cached — a paper can appear later, so the next
call asks again.

## E5 — a page budget for mirror bodies

`fetchFromMirrors` read `res.text()` with no limit, and up to one body per mirror can be held at
once. A page is now read against a 20 MB budget (`MAX_PAGE_BYTES`):

- a declared `content-length` past the budget is dropped before a byte is read;
- a streaming body is counted as it arrives and cut off past the budget, with the reader cancelled
  in a `finally`;
- `probeMirror`'s identity check reads through the same reader.

The failure names the budget (`page is larger than the 20 MB budget`) instead of surfacing later
as an unexplained timeout.

## Targets the plan no longer carries

- **Restated:** the offline suite has no absolute ceiling; a wave that makes the gate slower than
  it found it has to say so. The remaining time is real install/build coverage.
- **Dropped:** `README.md` ≤ 250 lines. What remains is read by the person installing the server.

## Regression checks

Fails on `874ec18`, passes on the branch (test files copied into a worktree of the previous commit
and built there):

- `search_papers resolves direct PDFs only when requested and keeps search best-effort` — extended
  with the real agent shape: after an enriched search, `get_paper` on the same DOI makes **zero**
  further mirror requests.
- `one Sci-Hub resolution serves concurrent callers, and a miss is not cached` (E6).
- `a mirror that declares an oversized page is dropped before its body is read` (E5).
- `a mirror that streams past the budget is cut off mid-body` (E5).
- `probeMirror reports an oversized identity-check page instead of holding it` (E5).

One existing test changed: `when every mirror answers with a challenge…` resolved a DOI an earlier
test in the same file had already resolved, so the cache answered and the mirrors were never
asked. It now uses its own identifier — the assertion is about mirror behaviour, and the cache is
per identifier.

## Measured

| | Wave 1's reading | Now |
|---|---|---|
| Offline suite | 259 tests, 17.16 s | 263 tests, 17.7–18.3 s |
| `pnpm run verify` | 18.5 s | 18.9 s |
| Mirror races for one DOI across search + `get_paper` | 2 | 1 |

This sandbox is noisy: two runs under other load reported 28–30 s for the same suite, so read the
columns as the quiet-run reading, and single seconds as noise.

## Full gate

```
pnpm install --frozen-lockfile        ok
pnpm run preflight                    ok   (5/5)
pnpm run verify                       ok   263 pass / 0 fail / 0 skipped, selfcheck green
node scripts/install.mjs --dry-run    ok
pnpm run package:artifacts            ok   .tgz + .mcpb + SHA256SUMS
pnpm run package:verify               ok   consumer launches outside the checkout
```

The Node 22.0.0 runtime-floor leg and the broken-pairing startup guard run in CI, not here.

## Left for the next wave

- Nothing scheduled. Every row of the draft plan is delivered or carries a "do not re-propose"
  note; the next wave needs new evidence from a report or an observed failure.
- One decision still open from wave 1: `scripts/preflight.mjs` suggests `zod@3.23.8` when advising
  a zod-3 pin. That version is not in the manifest (it is the last v3 release), so it needs its own
  judgement rather than the manifest treatment `H1` got.

## Published

| | |
|---|---|
| CI | run #76 on `4b62baf`, 6/6 jobs (build 22/24, artifacts linux/macOS/windows, live) |
| npm | `@vernikr/biblio-mcp@2.2.8`, published from the tested tarball (shasum `70d65f59707bc36f063e8f94231cde609df7c0fd`) |
| Public launchers | `node scripts/check-artifacts.mjs --registry`: all 7 modes pass |
| GitHub release | [`v2.2.8`](https://github.com/vernikr/biblio-mcp/releases/tag/v2.2.8) with `.tgz` (54 545 B), `.mcpb` (5 610 410 B), `SHA256SUMS` |
