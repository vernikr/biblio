# Wave 2 — repository hygiene and one entry point

Scope: bucket A1/A2/A3 and B2 from `biblio-mcp-refactor-plan.md`. Two commits on top
of wave 1 (`bd8cbd4`). No behaviour change.

## Done

| Task | Change |
|---|---|
| A1 | Deleted 11.7 MB of committed binaries and duplicates: 2 × `.mcpb` (11.2 MB), 2 × `.tgz`, `source-snapshot.zip`, `pr1-source.zip`, and the 75-file `reproductions/fresh-checkout/` copy of the checkout. `SHA256SUMS` stays; the note in the archive README records where the bytes live now. |
| A2 | `docs/worklog/biblio-mcp-review/` → `docs/worklog/archive/2026.10.09-biblio-mcp-review/`; `docs/worklog/biblio-mcp-audit.md` → `docs/worklog/archive/2026.10.08-audit/`. All 5 pointers outside the folder retargeted; both archived notes carry an "this is a snapshot, not instruction" banner. |
| A3 | `docs/STATE.md` no longer hard-codes a version (it points at `package.json` and the releases page) and its "next code work" section is the current refactor backlog instead of the closed PR1–PR4 plan. |
| B2 | `AGENTS.md` gained a 9-line "Current state" block and lost the pointer into the worklog. It is now the only document an agent needs on first read. |

## Measured

| | Before | After |
|---|---|---|
| Tracked tree | 15 MB | **2.1 MB** |
| Files tracked | 308 | 229 |
| `docs/` | 14 MB | 1.3 MB |
| CI runner time per push | 333 s | **292 s** |
| CI PR wall time | ≈ 3–5 min | **2:07** (run #61, 7/7 green) |

## One hypothesis I got wrong

I expected deleting the 14 MB worklog to speed up the suite, because three installer
tests copy the whole checkout into a temp directory. It does not: that copy measured
~20 ms before the deletion (page cache), and `install.test.mjs` is unchanged at ~11 s.
The real wins from A1 are clone size and search noise — `rg`, globs and `knip` no
longer return hundreds of matches inside an evidence archive. Recorded in the plan so
the next agent does not repeat the guess.

## Full gate, clean checkout

```
pnpm install --frozen-lockfile   ok
pnpm run preflight               ok   (5/5)
pnpm run verify                  ok   232 pass / 0 fail / 0 skipped, selfcheck green
node scripts/install.mjs --dry-run   ok
node --test <5 floor files>      ok
```

GitHub Actions [run #61](https://github.com/vernikr/biblio-mcp/actions/runs/38059115788):
7/7 jobs green — build (22) 31 s, build (24) 30 s, runtime-floor 19 s,
artifacts ubuntu 28 s / macos 32 s / windows 127 s, live 25 s.
