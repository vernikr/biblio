# Wave 3 — facts that stay true

Third wave of iteration 2. Scope: the two facts left in the tree without a single definition —
the last hand-written dependency version and the mirror registry's per-host audit annotations —
plus the live evidence pass a wave is supposed to start from, since the plan holds no scheduled
row.

Two commits on top of `aa8a691` (2.2.8), branch `refactor/iteration2-wave3`.

## Evidence pass — measured

Live probes, 2026-10-11, every tool called through the real server (`dist/server.js`) against the
real mirrors from this sandbox.

| Question | Measurement | Verdict |
|---|---|---|
| The `mirrors[]` URLs `get_paper` returns carry `%2F` (`encodeURIComponent` on the DOI). Are they usable? | Fetching every configured Sci-Hub host with the encoded and the plain path: `sci-hub.ren`, `sci-hub.mksa.top` and `sci-hub.hkvisa.net` answer the article page with its PDF embed either way; `sci-hub.ru` and `sci-hub.st` answer a human-verification page either way. | **No change** — the encoding is not what decides the answer. |
| Can a challenge page be mistaken for a paper? | `Sci-Hub: are you are robot?` pages are caught by the existing marker and the resolver moves to the next host. | **No change.** |
| Do the mirror annotations still describe reality? | `annas-archive.gl` aborts at the 8 s budget (the file said "200, ~1.2 s"), `sci-hub.ru` challenges (the file said "200, ~0.8 s"), `libgen.vg` is unreachable (the file said "200, ~0.9 s"). | **Changed** — see H5. |
| Does one unavailable source slow every search? | With Anna's Archive challenged: `search_books` 6.1 / 7.4 / 5.0 s on the first three calls, then 1.65 s once the circuit opens; `search_papers` 2.5 / 1.4 / 1.2 s throughout. | **No change** — the documented three-strike isolation, doing what it says. Recorded so nobody "fixes" it by accident (`E8`). |
| Is `healthcheck`'s `unreachable` list misleading, given Z-Library is off by default? | The same response carries `defaults.disabledByDefault`, and the summary costs ~8 s because the slowest host is probed under the shared timeout. | **No change** — the answer is already in the response. |

## H4 — the last hand-written version

`scripts/preflight.mjs` told an agent to run `pnpm add zod@3.23.8 --save-exact` when a zod-3-only
SDK met zod 4. Nothing in the project pins `3.23.8`: it is whatever that version was when the line
was written. The advice now names the range the **installed SDK** declares — for the fixture that
used to hard-code it, `pnpm add "zod@^3.23.8"`, and whatever another SDK declares when it declares
something else.

## H5 — the registry stops claiming measurements

`src/mirrors.ts` annotated every host with an audit result (`// 200, ~0.8 s`,
`// unreachable at last audit`). Those are the volatile numeric facts the repo's documentation
rules keep out of evergreen files, and today's probe already shows two of them false. The file now
says what is durable — the order is a weak preference rather than a ranking, a host that is down
stays listed because these hosts come back, which hosts are deliberately absent and why — and
leaves the live picture to the `healthcheck` tool, which measures it on demand.

## Regression checks

- `the zod advice names the range the installed SDK declares` — copied into a worktree of
  `aa8a691`, run there: `not ok 5` (the old message always said `3.23.8`); passes on the branch.
- H5 changes comments only. The host lists are byte-identical, asserted by diff; the existing
  `every mirror group has a positive site-identity marker` test still guards the groups.

## Measured

| | Wave 2's reading | Now |
|---|---|---|
| Offline suite | 263 tests | 264 tests |
| Hand-written dependency versions reachable from `src/` or `scripts/` | 1 | 0 |

Suite wall time in this sandbox is noisy (18–40 s for the same tree, run to run), so no reading here
is a speed claim; the plan's restated target says a wave that makes the gate slower than it found it
has to say so — this one does not.

## Full gate

```
pnpm install --frozen-lockfile        ok
pnpm run preflight                    ok   (5/5)
pnpm run verify                       ok   264 pass / 0 fail / 0 skipped, selfcheck green
node scripts/install.mjs --dry-run    ok
pnpm run package:artifacts            ok   .tgz + .mcpb + SHA256SUMS
pnpm run package:verify               ok   consumer launches outside the checkout
```

The Node 22.0.0 runtime-floor leg and the broken-pairing startup guard run in CI, not here.

## Left for the next wave

- Nothing scheduled. The two rejected items with numbers attached are `E8` (the Anna's Archive
  circuit) and, from iteration 1, the serialiser and stall-timer rows.
- The live probes above are the kind of evidence a next wave should start from: they were cheap and
  one of them was wrong. Nothing in the suite can notice a mirror annotation that went stale.

## Published

| | |
|---|---|
| CI | run #78 on `64e03d2`, 6/6 jobs (build 22/24, artifacts linux/macOS/windows, live) |
| npm | `@vernikr/biblio-mcp@2.2.9`, published from the tested tarball (shasum `f924fe593fa2dcc8b0e4dd839be1799241ed7c60`) |
| Public launchers | `node scripts/check-artifacts.mjs --registry`: all 7 modes pass |
| GitHub release | [`v2.2.9`](https://github.com/vernikr/biblio-mcp/releases/tag/v2.2.9) with `.tgz` (54 443 B), `.mcpb` (5 610 398 B), `SHA256SUMS` |
