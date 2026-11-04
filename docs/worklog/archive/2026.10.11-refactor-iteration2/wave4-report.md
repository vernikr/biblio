# Wave 4 — a failed download comes back

Fourth wave of iteration 2. Scope: `E9` and `F6`, both from one live run — `download_book` on a
192 KB PDF sat for two minutes and then reported a gateway error, and the two attempts after it
never came back at all.

Two commits on top of `dbbfbbb` (2.2.9), branch `refactor/iteration2-wave4`.

## Evidence — a live download that never ends

2026-10-11, this sandbox, the published version: `search_books` returned 20 results in 7.4 s, then
`download_book` for the smallest PDF in them (192 KB) —

- the call outlived the default MCP client timeout (60 s), so the client gave up before the tool
  answered;
- run outside the client, the same link finally answered `HTTP 504` after **125 s**;
- two further small PDFs (269 KB, 34 KB) never sent a single byte: the budget gave them **600 s**,
  so they were still waiting when a 100 s failsafe aborted them — and the reason an agent would
  have seen was the transport's own `This operation was aborted`.

The budget that allowed this is `BIBLIO_DOWNLOAD_TIMEOUT_MS`, which covers the wait for response
headers. The transfer itself has a 30 s silence watchdog, so the two phases disagreed by a factor
of twenty about what "too long" means.

## E9 — one silence budget for both phases

`BIBLIO_DOWNLOAD_TIMEOUT_MS` now defaults to 30 000 ms, the same as the transfer's stall watchdog:
an attempt fails after half a minute of silence, whatever it was waiting for. Both settings stay
overridable, and the README table is regenerated from the registry, so the documented default is
the real one.

| | Before (2.2.9) | After |
|---|---|---|
| A link that never answers (local stub, shipped defaults) | up to 600 000 ms | 30 007 ms |
| A live 34 KB link from a stuck mirror | 100 s+, still waiting | 33 011 ms, then 831 ms on the next attempt |
| A mirror that answers `HTTP 503` immediately | fast (unchanged) | 831 ms |

## F6 — the reason names the silence that killed it

`no response headers within 30000 ms (BIBLIO_DOWNLOAD_TIMEOUT_MS) for <url>` and
`transfer stalled for 30000 ms after <n> bytes (BIBLIO_DOWNLOAD_STALL_MS) for <url>` replace the
transport's `This operation was aborted` and the weaker `download stalled or timed out after N
bytes`. An agent can now tell "this link is dead, let `fetch_book` try the next copy" apart from
"the transfer died halfway".

## Regression checks

Fail on `dbbfbbb`, pass here (the test files copied into a worktree of the previous commit and run
there):

- `a silent file server is not waited on longer than a client will listen` — the default guard.
- `a server that never sends headers is cut off by the header budget` — the message assertion.
- `a body that goes silent is cut off by the idle watchdog, not the header budget` — the message
  assertion.

## Measured

| | Wave 3's reading | Now |
|---|---|---|
| Offline suite | 264 tests | 265 tests |
| `BIBLIO_DOWNLOAD_TIMEOUT_MS` default | 600 000 ms | 30 000 ms |

The success path is untouched: a 417 KB PDF still downloaded in 8 s from a working mirror
(measured this wave, MD5 verified).

## Full gate

```
pnpm install --frozen-lockfile        ok
pnpm run preflight                    ok   (5/5)
pnpm run verify                       ok   265 pass / 0 fail / 0 skipped, selfcheck green
node scripts/install.mjs --dry-run    ok
pnpm run package:artifacts            ok   .tgz + .mcpb + SHA256SUMS
pnpm run package:verify               ok   consumer launches outside the checkout
```

The Node 22.0.0 runtime-floor leg and the broken-pairing startup guard run in CI, not here.

## Left for the next wave

- `fetch_book` spends one budget per copy, so three dead copies still cost 90 s. Not scheduled:
  it needs a live run that shows that shape (wave 4 saw one dead link, then a fast failure).
- Everything else in the plan is delivered or carries a "do not re-propose" note.

## Published

| | |
|---|---|
| CI | run #80 on `c4012b2`, 6/6 jobs (build 22/24, artifacts linux/macOS/windows, live) |
| npm | `@vernikr/biblio-mcp@2.2.10`, published from the tested tarball (shasum `c19857b40034e0752fc20941d95cadab2f10ba70`) |
| Public launchers | `node scripts/check-artifacts.mjs --registry`: all 7 modes pass |
| GitHub release | [`v2.2.10`](https://github.com/vernikr/biblio-mcp/releases/tag/v2.2.10) with `.tgz` (54 576 B), `.mcpb` (5 610 525 B), `SHA256SUMS` |
