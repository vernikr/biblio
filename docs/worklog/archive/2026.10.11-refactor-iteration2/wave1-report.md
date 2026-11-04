# Wave 1 — one definition per fact

First wave of iteration 2. Scope: the plan's "volume — duplicated logic, drift" bucket (A7, A9,
A10, H1, H2), the two agent-facing rows that come with it (F2, A11'), plus the evidence re-check
the plan demands before a row is scheduled — which retired C1' instead of implementing it.

Eight commits on top of `068f1dc` (2.2.6), branch `refactor/iteration2-wave1`.

## Done

| Task | Change | Commit |
|---|---|---|
| A10 | `BOOK_SOURCE_IDS` in `src/types.ts` is the one source list: the two tool enums, the default selection and the provider registry read it, and the two `sources as SourceId[]` casts are gone. A tool-surface test pins that the client, the defaults and the providers see the same list. | `b4bfa82` |
| A7 | `describeArgsError` asks the tool's own Zod schema instead of parsing the SDK's flattened error text; `validationIssuesFrom` and its three text branches are deleted, and the two extractors became one function in `toolmeta.ts`. | `85048e0`, `672d2fd` |
| A9 | `anchorsToLinks` in `parse.ts` walks the anchor list once; each provider keeps only its own rule (which href counts, what to call it, whether repeats are listed twice). `absoluteUrl` is no longer imported by Libgen. | `d1a19af` |
| H1 | `src/pkg.ts` reads `package.json`; the server version and the selfcheck fix line come from it, and `scripts/preflight.mjs` names the pinned SDK in its advice. | `597e643`, `6e7138a` |
| H2 | Sniffing no longer gates on a four-byte minimum and no longer compares the content-type case-sensitively; each matcher reads only the bytes it needs. | `1641274` |
| F2 | `--selfcheck` prints the tool names it verified under the tools stage. | `597e643` |
| A11' | `test:all` removed; `verify:live` already covers offline-then-live. 20 scripts → 19. | `c81dec7` |

## A7 — the agent-facing text does not move

The plan called this the risky row: the sentence an agent reads after a bad call. Two decisions
kept the text byte-identical for every shape the suite pins:

- Array paths keep the `sources[0]` rendering the SDK used to produce, rather than the
  `sources.0` a naive `join(".")` gives.
- The six pinned shapes (missing field, wrong type, bad format, out of range, bad enum member,
  empty-after-trim string) each read the same before and after. One of them initially differed —
  `sources[0]` vs `sources.0` — and was reconciled back.

What actually changed is where the sentence comes from. The old path parsed the SDK's error string
with `/Input validation error: Invalid arguments for tool [^:]+: ([\s\S]*)/` and guessed the issue
code from the words; a reworded SDK upgrade would have silently returned raw Zod text to agents.
The extractor now runs the tool's own schema first, so the SDK's wording is decoration. The test
`the sentence does not depend on how the SDK words its own failure` replaces the SDK validator with
a differently-worded failure and asserts the readable sentence still arrives.

## C1' — evidence re-check retired the row

The plan said `runInstall({ packageManager })` "skips the ~350 ms probe, but no caller passes it".
That is no longer true: `installHere` in `test/install.test.mjs` has defaulted to
`stubPackageManager: true` since `c1fd358` (iteration 1, wave 3), and only the package-manager
detection tests opt back in. Measured profile of the file — 6.1 s total:

| Test | Time |
|---|---|
| "leaves a malformed config … on a real install" | 1,679 ms |
| "builds a clean checkout, merges an existing config" | 1,669 ms |
| "docs:env builds changed source before generating the README table" | 775 ms |
| three CLI entry-point tests (spawn) | 418 / 452 / 519 ms |
| the other 22 tests | ≤ 94 ms each |

The remaining time is genuine install/build work, which the plan itself says must keep probing.
**Recommendation: drop the ≤ 13 s suite target or restate it.** The cheapest honest reduction
available is the two real-install tests sharing one built fixture; everything else is the price of
testing a real installer.

## Measured

| | Before (`068f1dc`) | After |
|---|---|---|
| Offline suite | 18.08 s, 243 tests | **17.16 s, 259 tests** |
| `pnpm run verify` | 19.5 s | **18.5 s** |
| Copies of the source list in `src/` | 3 | 1 |
| Extracting functions for zod issues | 2 | 1 |
| Hard-coded dependency versions in `src/` | 1 | 0 |
| Scripts in `package.json` | 20 | 19 |

(The project machine baseline was 15.8 s; this sandbox runs slower and is the only machine
available to this session. Both columns were measured here.)

## Regression checks

Each of these fails on `068f1dc` and passes on the branch, verified by copying the test files into
a worktree of the previous commit and building it:

- `--selfcheck prints the tool names it verified` (F2).
- `sniffExt classifies a truncated head by the bytes that are there` (H2) — the old length gate
  answered "bin" for a two-byte ZIP signature.
- `sniffExt reads the content-type header whatever its case` (H2) — `Application/PDF` produced
  "bin".
- `the sentence does not depend on how the SDK words its own failure` (A7).
- `describeArgsError reports nothing when there is no schema to ask` (A7, contract change).
- `the SDK fix it suggests follows the version this package pins` (H1).

Three new tests are **characterization guards**, not regression checks — they pass on the old code
and exist to keep the behaviour they describe:

- the six pinned argument-error sentences (identical text before and after);
- `one source list reaches the client, the defaults and the providers` (fails on the old tree only
  because the new export does not exist there);
- `the shared anchor pass keeps each provider's own rule for repeated links` (the per-provider
  rules it pins were already true).

## Full gate

```
pnpm install --frozen-lockfile      ok
pnpm run preflight                  ok   (5/5)
pnpm run verify                     ok   259 pass / 0 fail / 0 skipped, selfcheck green
node scripts/install.mjs --dry-run  ok
pnpm run package:artifacts          ok   .tgz + .mcpb + SHA256SUMS
pnpm run package:verify             ok   consumer launches outside the checkout
```

The Node 22.0.0 runtime-floor leg and the broken-pairing startup guard run in CI, not here.

## Left for the next wave

- `E6` — re-measure the Sci-Hub resolution cache before scheduling it (iteration 1's `E2` may have
  removed the need).
- `E5` — the `content-length` cap stays deferred; no OOM observed.
- The `≤ 250` line README target needs a decision, as the plan recommends dropping it.
- One more hard-coded version worth a look: `scripts/preflight.mjs` still suggests `zod@3.23.8`
  when advising a zod-3 pin. That specific version is not in the manifest (it is the last v3
  release), so it needs its own decision rather than the manifest treatment `H1` got.

## Published

| | |
|---|---|
| CI | run #73 on `bbeb315`, 6/6 jobs (build 22/24, artifacts linux/macOS/windows, live) |
| npm | `@vernikr/biblio-mcp@2.2.7`, published from the tested tarball |
| Public launchers | `node scripts/check-artifacts.mjs --registry`: npm, npx, pnpm dlx and MCPB all pass |
| GitHub release | [`v2.2.7`](https://github.com/vernikr/biblio-mcp/releases/tag/v2.2.7) with `.tgz`, `.mcpb`, `SHA256SUMS` |
