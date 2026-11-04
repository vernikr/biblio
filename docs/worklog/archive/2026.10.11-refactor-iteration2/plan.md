# Refactor, iteration 2 — draft plan

Iteration 1 is closed (waves 1–5, CI runs #61–#70 green). This is the backlog it left behind:
everything below was found during iteration 1 and deliberately not done, either because the
estimate was wrong or because it did not fit a wave.

**Status: closed.** Iteration 2 was delivered in four waves (2.2.7 … 2.2.10). Every row below is
either delivered or carries a "do not re-propose" note; each delivered row was re-checked against
the tree when this folder moved to the archive.

**How it was run, kept for the record:** rows were scheduled one wave at a time, each after its
evidence cell had been re-checked against the tree — three of iteration 1's estimates turned out to
be wrong after measuring (`C1`'s 11.5 s → 3 s, `E3`, `E4`). Wave 3 ran the evidence pass the plan
demands of any next wave (a live dogfood of every tool); wave 4 came out of it — a live download
that outlived its caller.

## Wave 1 — one definition per fact

Scope: `A7`, `A9`, `A10`, `H1`, `H2`, `F2`, `A11'`. The evidence re-check retired `C1'` before it
was implemented: `installHere` has stubbed the package-manager probe since iteration 1, and the
rest of that file's time is real install/build work. Report and measurements:
[`wave1-report.md`](wave1-report.md). `H1` also covers `scripts/preflight.mjs`, whose advice named
a dependency version by hand.

## Wave 2 — measured hardening

Scope: `E6`, `E5`, with their evidence re-checked first. `E6` was real, measured before it was
built: the same DOI resolved once by an enriched `search_papers` and again by the follow-up
`get_paper` — two mirror races, the second costing a full round trip (159 ms against a mirror
answering in 150 ms; 1 ms after the change). `E5` was scheduled because the owner asked for the
protection rather than waiting for an observed OOM. Report:
[`wave2-report.md`](wave2-report.md).

## Wave 3 — facts that stay true

Scope: `H4` and `H5`, the two facts left in the tree without a single definition, plus the live
evidence pass a wave is supposed to start from. Report and measurements:
[`wave3-report.md`](wave3-report.md). The pass closed one suspicion (the `%2F`-encoded mirror URLs
`get_paper` returns are fine — the mirrors answer the same with and without), confirmed one drift
(the mirror registry's audit annotations were already false today) and rejected one tempting change
(opening the Anna's Archive circuit on the first challenge).

## Wave 4 — a failed download comes back

Scope: `E9` and `F6`, both from the wave-3 live pass: a live `download_book` for a 192 KB PDF sat
for 125 s before answering, and two further links never answered inside their 600 s budget, so the
agent's client had long given up. The header wait now matches the transfer's silence budget (30 s
by default), and a failed attempt says which silence killed it. Report and measurements:
[`wave4-report.md`](wave4-report.md).

Nothing in this plan is unscheduled now: every row is either delivered (waves 1–4) or carries a
"do not re-propose" note.

## Where iteration 1 finished against its own targets

| Metric | Target | Now | Gap |
|---|---|---|---|
| Tracked tree | ≤ 4 MB | 2.1 MB | met |
| Unused exports in `src/` | 0 | 0 | met |
| CI jobs per push | ≤ 5 | 6 | near |
| Offline suite wall time | ≤ 12 s | 15.8 s | dropped |
| `pnpm run verify` | ≤ 15 s | 16.3 s | dropped |
| `README.md` | ≤ 250 lines | 395 | dropped |

Both remaining gaps were closed as decisions, not as work: the maintainer half of the README left
the file in iteration 1 and what remains is read by the person installing (cutting to 250 means
deleting consumer content), and the suite's remaining time is genuine install/build coverage.
Confirmed with the owner after wave 1 measured `C1'` as already delivered.

## Candidates

Priority order is unchanged from iteration 1: (1) context and speed for the agent developing the
project, (2) hidden bugs, (3) E2E performance and memory, (4) experience for agents using the
tools.

### Volume — duplicated logic, drift

| # | Task | Evidence in the tree today | Benefit | Cost | Risk |
|---|---|---|---|---|---|
| **A7** | [wave1-report.md](wave1-report.md) | — | — | — | — |
| **A9** | **Done (wave 1).** `anchorsToLinks` in `parse.ts` walks the anchors once; each provider keeps only its own rule. | [wave1-report.md](wave1-report.md) | — | — | — |
| **A10** | **Done (wave 1).** `BOOK_SOURCE_IDS` in `src/types.ts` is the one list; both enums, the defaults and the provider registry read it, and the casts are gone. | [wave1-report.md](wave1-report.md) | — | — | — |
| **A11'** | **Done (wave 1).** `test:all` removed; `verify:live` already covers offline-then-live. 20 scripts → 19. | [wave1-report.md](wave1-report.md) | — | — | — |
| **H1** | **Done (waves 1, 3).** `src/pkg.ts` supplies the SDK version to the selfcheck line and to `scripts/preflight.mjs`; the zod half of that same advice follows the range the installed SDK declares (`H4`). | [wave1-report.md](wave1-report.md), [wave3-report.md](wave3-report.md) | — | — | — |
| **H2** | **Done (wave 1).** The four-byte minimum and the case-sensitive content-type compare are gone; each matcher reads only the bytes it needs. | [wave1-report.md](wave1-report.md) | — | — | — |

| **H4** | **Done (wave 3).** The zod advice in `scripts/preflight.mjs` named `3.23.8` by hand; it now names the range the installed SDK declares. | [wave3-report.md](wave3-report.md) | — | — | — |
| **H5** | **Done (wave 3).** `src/mirrors.ts` annotated every host with an audit result; two were already false. The durable statements stay, the measurements go to the `healthcheck` tool. | [wave3-report.md](wave3-report.md) | — | — | — |

### Check speed

| # | Task | Evidence | Benefit | Cost | Risk |
|---|---|---|---|---|---|
| **C1'** | ~~Thread `packageManager` through the test call sites.~~ **Retired** — the call sites already stub the probe (iteration 1's `c1fd358`); the remaining 6.1 s of `install.test.mjs` is genuine install/build work. See [`wave1-report.md`](wave1-report.md). | re-checked | — | — | — |

### Behaviour and performance

| # | Task | Evidence | Benefit | Cost | Risk |
|---|---|---|---|---|---|
| **E9** | **Done (wave 4).** `BIBLIO_DOWNLOAD_TIMEOUT_MS` defaults to 30 s, matching the transfer's stall watchdog, so a stuck link fails inside a client's patience instead of after 600 s. | [wave4-report.md](wave4-report.md) | — | — | — |
| **E6** | **Done (wave 2).** Resolutions are memoized for the provider TTL with shared in-flight work; a miss is not memoized. Re-checked by measurement first: the duplicate resolution was real. | `src/providers/scihub.ts` | — | — | — |
| **E5** | **Done (wave 2).** A 20 MB page budget: a declared length is checked before the body is read, a streaming body is counted and cut off, and `probeMirror`'s identity check uses the same reader. | `src/http.ts` | — | — | — |
| **F6** | **Done (wave 4).** A failed download names the budget that fired (`no response headers within 30000 ms…`, `transfer stalled for 30000 ms after N bytes…`) instead of the transport's `This operation was aborted`. | [wave4-report.md](wave4-report.md) | — | — | — |
| **F2** | **Done (wave 1).** `--selfcheck` prints the tool names it verified under the tools stage. | [wave1-report.md](wave1-report.md) | — | — | — |

## Carried over as rejected — do not re-propose without new evidence

| # | What | Why not |
|---|---|---|
| `E8` | Open the Anna's Archive circuit on the first all-mirror challenge instead of after three. | Measured: a challenged first search costs 5–7 s, ~1.7 s once the circuit opens. But DDoS-Guard challenges are often per-request, so one bad minute would become a five-minute outage. Needs evidence that a challenge repeats before it can be proposed again. |
| `E3` / `D6` | Stop serialising every Libgen row (`forEachRow` calls `$row.html()` up to 100×). | **Built and measured slower.** Reverted. |
| `E4` | Stop re-arming the stall timer on every 16 KB chunk. | **Built and measured inside I/O noise** (~3,200 timer pairs for a 50 MB book). Reverted. |
| `B3` | Consolidate 35 test files into ~12. | Measured: per-file process cost is 85 ms, so the whole change saves ~1 s off 15.8 s. 21 of 35 files set `BIBLIO_*` at module scope that `dist/` reads once at import, so each merge needs a hand-built shared stub server. |
| `A8` | One in-memory MCP client helper. | Not duplication: 6 of 10 callers set env **before** importing built modules. |
| `F5` | `nextStep` on the "nothing reachable" healthcheck. | Already covered by the existing error text. |
| `D11` | `AsyncTtlCache` never reaps when traffic stops. | Bounded by `maxEntries`; expiry-on-read already works. |
| — | Replace cheerio with a lighter parser. | The parsers are the fragile part; the captured fixtures are the safety net. High risk, no context benefit. |
| — | Rewrite git history to purge the deleted binaries. | Chosen against in iteration 1: delete from HEAD only. |

## Definition of done for iteration 2

Same non-negotiable as iteration 1: `pnpm run verify` green with **0 skips**, every bug-fix test
demonstrated to fail on the previous commit, and the full CI gate after each wave.

Targets, as agreed after wave 1 measured them:

- **Restated: the offline suite has no absolute ceiling.** Its remaining time is real
  install/build coverage (`C1'` was retired as already delivered), so a fixed second count is not
  a target — but a wave that makes the gate slower than it found it has to say why in its report.
- **Dropped: `README.md` ≤ 250 lines.** What is left is read by the person installing the server.
- Kept: every `src/` symbol that names a version, a source or a tool is defined once — delivered
  across waves 1–2.
- Kept: no row is scheduled until its "evidence" cell has been re-checked against the tree.
