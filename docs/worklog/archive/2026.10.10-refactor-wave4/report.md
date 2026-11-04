# Wave 4 — behaviour

Scope: bucket D/E from `biblio-mcp-refactor-plan.md` — D1/E1, D4, D5/E2, D8, D9,
D10. Five commits on top of wave 3 (`9a952bf`). Every change except the two
documentation-only ones carries a test that fails on the previous code.

## Done

| Task | Change |
|---|---|
| D1 / E1 | `fetch_book` no longer re-runs a search per failed copy. `saveBook` accepts the copies the caller already ranked; `fetch_book` passes them, and reports the copies it never reached as `alternatives` with a `nextStep`. The title lookup by `findAlternatives` stays for `download_book`, which has no ranked list. |
| D4 | `get_download_links` no longer reports a source unavailable when that source supplied links. Anna's Archive is asked twice (member API, scraped page); a failure is recorded only when neither answered. |
| D5 / E2 | Sci-Hub parses the winning article page once. A mirror-race validator may now hand its parse back, so one `cheerio.load` yields both the PDF location and the title. **57–65 ms → 27–28 ms** per lookup on a realistic 230 KB page. |
| D8 | `downloadToFile` now says who owns `destPath`: bytes go to `${destPath}.part`, so the caller must pass a name no other call uses. |
| D9 | `plainFileName` refuses `CON`, `NUL`, `COM1`…`LPT9` (with or without an extension) and names ending in a dot — Windows cannot create them, or silently rewrites them, so the file would land under a name other than the one reported back. |
| D10 | The SDK hook that turns raw Zod dumps into readable argument errors is private. Its absence is now reported on stderr instead of silently downgrading every agent's error messages. |

## Measured

| | Before | After |
|---|---|---|
| `scihub.resolve`, 230 KB page, 3 mirrors | 57–65 ms | **27–28 ms** |
| Offline suite | 232 tests | **242 tests**, all green |
| `pnpm run verify` | 16.4 s | 17.4 s (10 new tests) |

## Two plan items I did not ship, and why

**E3 / D6 — stop serialising every Libgen row — rejected.** The plan proposed
reading the md5 and DOI from the row's anchor `href`s instead of `$row.html()`.
Built and measured: it is *slower*. A synthetic 100-row page went 25 ms → 26 ms,
a 500-row page 74–84 ms → 88–89 ms. `$row.find("a")` traverses the same subtree
that `.html()` serialises, and costs slightly more. Reverted, not shipped.

**E4 — stop re-arming the stall timer on every chunk — rejected.** The timer
churn is real and measurable in isolation: 3,200 `clearTimeout`+`setTimeout`
pairs cost ~31 ms, i.e. ~30 ms per 50 MB book. End to end it disappears: 40 MB
in 4 KB chunks (10,240 chunks) measured 172–206 ms after the change against
183–186 ms before — the download's own I/O noise is larger than the saving. The
rewrite was behaviour-neutral (the deadline is the last chunk plus the stall
budget either way), but it buys nothing observable in code that carries the most
risk in the project. Reverted, not shipped.

Both are recorded in the plan so the next agent does not rebuild them.

## Regression proofs

Each of these fails on the previous commit and passes on this one:

- `test/acquire.test.mjs` — `saveBook` never looks up alternatives when the caller already ranked them; `fetch_book` names the copy it did not reach; `fetch_book` pays for no second lookup per failed copy.
- `test/details.test.mjs` — a source that answered with links is not listed as unavailable (the old report contained both the `annas` error and the `annas` link).
- `test/http.test.mjs` — `fetchFromMirrors` hands the validator's parse back, and a validator returning `false` still produces the generic reason.
- `test/download-filename.test.mjs` — `con`, `NUL.pdf`, `com1`, `lpt9.txt`, `book.pdf.` are refused and nothing is written.

## Full gate on HEAD (`13ecbd1`)

```
pnpm run typecheck                  ok
pnpm run preflight                  ok
pnpm run verify                     ok   242 pass / 0 fail / 0 skipped, selfcheck green
node scripts/install.mjs --dry-run  ok
node --test <5 floor files>         ok
```

`knip`: 0 unused values in `src/` (unchanged from wave 1).

GitHub Actions [run #66](https://github.com/vernikr/biblio-mcp/actions/runs/38088542315):
6/6 green — build (22) 35 s, build (24) 31 s, artifacts ubuntu 25 s / macos 45 s /
windows 120 s, live 24 s. Runner time 280 s against 266 s for the wave-3 push, i.e.
unchanged within the run-to-run swing recorded in the wave-3 report.
