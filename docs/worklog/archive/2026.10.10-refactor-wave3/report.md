# Wave 3 — CI speed-up

Scope: bucket C from `biblio-mcp-refactor-plan.md` — C1, C2, C4, C5, C6. Three
commits on top of wave 2 (`65f30e5`). No behaviour change; C2 fixes a test that
could fail for the wrong reason.

## Done

| Task | Change |
|---|---|
| C1 | `scripts/install.mjs` no longer runs at import. The logic lives in `runInstall({ argv, write, capture, packageManager })` behind an `invokedDirectly` guard — the same shape `scripts/preflight.mjs` already uses — and output goes to a `write` sink instead of `process.stdout`. 20 of the 22 installer tests call it in-process; the two that really install and build a throwaway checkout stay subprocesses. |
| C2 | `download-deadline.test.mjs` sends headers plus one chunk immediately, then the whole body after a single 250 ms pause, instead of pacing 12 chunks 60 ms apart. |
| C4 | `runtime-floor` is gone as a job. Its five test files run against Node 22.0.0 inside the `build` job's Node-22 leg, which already has a built `dist/`. |
| C5 | The three-OS packaging matrix runs Ubuntu only on pull requests; pushes to `main` and tags still run all three. |
| C6 | The startup-guard step runs on one matrix leg instead of both. (Plan said cache its `npm install`; see below.) |

## Measured

| | Before | After |
|---|---|---|
| `install.test.mjs` | 10.7 s | **7.6 s** |
| `download-deadline.test.mjs` | 2.0 s | 1.6 s |
| Offline suite (`run-tests.mjs`, 2 cores) | 16.5 s | **15.8 s** |
| `pnpm run verify` | ≈ 22 s | **16.4 s** |
| CI jobs per push | 7 | **6** |
| CI runner time per push | 292 s / 316 s (runs #61/#62) | **266 s / 339 s** (runs #63/#64) |
| CI wall time (slowest job, Windows) | 127 s / 133 s | 114 s / 147 s |
| Suite at `--test-concurrency=16` | 1 flake | **3/3 clean, 232 pass** |

"Before" for the suite and `install.test.mjs` is the wave-2 commit re-measured in a
git worktree on the same machine, minutes apart, with the same command — not the
number from the wave-1 report, which was taken under different load.

## Two things worth recording

**The remaining cost of `install.test.mjs` is a `pnpm --version` subprocess, not
`node`.** Removing the 20 child processes saved only 0.4 s, because each run
still probed pnpm — 351 ms a call, ×12. Tests that are about config handling or
the flag matrix now inject the detected package manager; the happy path and the
package-manager test still probe the real thing. That took the file from 10.9 s
to 7.4 s. What is left is the 4.6 s of two tests that genuinely install and
build a checkout, which is the reason the file exists.

**C6 deviates from the plan.** The plan proposed caching the startup guard's
throwaway `npm install`. Running the step on one leg instead saves the same
network work, has no cache key that can go stale, and loses nothing: what the
step tests is a dependency pairing, not a Node version. A stale key would be
worse than a slow step, because the check would silently test the wrong tree.

## Full gate on HEAD (`7d03362`)

```
pnpm run typecheck                  ok
pnpm run preflight                  ok
pnpm run verify                     ok   232 pass / 0 fail / 0 skipped, selfcheck green
node scripts/install.mjs --dry-run  ok
node --test <5 floor files>         ok
```

GitHub Actions [run #63](https://github.com/vernikr/biblio-mcp/actions/runs/38062021091)
and [run #64](https://github.com/vernikr/biblio-mcp/actions/runs/38064795170): 6/6 green
both times. Run #63: build (22) 33 s, build (24) 32 s, artifacts ubuntu 27 s / macos 34 s /
windows 114 s, live 26 s — 266 s total.

**Do not read the runner-time delta as 50 s.** The packaging legs swing by tens of
seconds between runs on identical code (macos 34 s vs 65 s, windows 114 s vs 147 s), so
the honest statement is the structural one: one job disappears, and with it a full
checkout + install + build that bought nothing but a Node binary swap. Everything the
`runtime-floor` job checked still runs, on every push.
