# Wave 5 — structure

PR5 of the refactor plan: split the README by audience, consolidate the test suite, and give
maintainers one architecture page.

## 5a — architecture page and one recommended launcher

- `docs/architecture.md` (81 lines): one page describing the request flow and the three invariants
  that keep it honest — a mirror is believed only after an identity check (a 200 is not proof);
  HTML is never saved as a book; a caller-named file is never overwritten.
- `AGENTS.md` gained a one-line pointer to it.
- One recommended launcher end to end: the README FAQ now names `npx --yes
  @vernikr/biblio-mcp@latest`, and `scripts/install.mjs` step 7 notes that the entry it writes runs
  the checkout, not the published release.

Commit `08f0f12`, `4a5aadf`. No behaviour change.

## 5b — B1: the README is now a consumer page

The README carried two audiences at once: people installing the server, and agents changing it.
The maintainer half moved out.

| | Before | After |
|---|---|---|
| `README.md` | 581 | **395** |
| `AGENTS.md` (maintainer entry point) | 113 | 159 |
| `docs/architecture.md` | — | 81 (new) |
| `docs/about-this-fork.md` | — | 61 (new) |

Moved out of the README:

- the "why one server instead of four" comparison and the fork's before/after table →
  `docs/about-this-fork.md`. The README keeps an 11-line `## About this fork` stub with the one
  thing a reader needs before installing.
- the whole `## Development` block (clone and install, the Node note, the script list, the `src/`
  tree, the decisions/audit links, contributing) → `AGENTS.md`. The README's `## Development` is a
  6-line pointer to `AGENTS.md`, `docs/STATE.md` and `docs/architecture.md`.
- the "how it works" list (four steps that restate `docs/architecture.md`) → one line and a link.
- the Roadmap section → a pointer to `docs/STATE.md`. It described a plan that is finished and
  linked an archived audit, so it was the most stale thing in the file.

Tightened in place without losing substance: the three Install subsections (reordered so the
launcher comes first, since it is what the Quick start uses), the "built for AI agents" list, the
typical-flow example, the client-timeout note, and the Known limitations bullets — the
`annas-archive.li` war story kept its lesson and lost its hedging.

Two FAQ entries were dropped rather than moved: "what happens when a mirror goes down" and "can I
add my own mirrors" are both answered under Known limitations and Configuration.

Anchors checked before the move: `docs/agent-install.md` is the only file in the repo linking into
the README, and it points at `#for-ai-agents-install-this-package`, which is unchanged. The
in-page links `#install`, `#known-limitations` and `#configuration` are unchanged too.

## B3 — consolidating 35 test files into ~12: assessed, not done

The measured reason is that it would buy very little.

Node's runner starts one process per test file. Timing an empty test file with `node --test` puts
that cost at **85 ms**. Going from 35 files to 12 removes 23 × 85 ms ≈ **2 s of serial time**,
which is roughly **1 s off the 15.8 s wall-clock suite** with two workers — about 6%.

What that 1 s would cost: 21 of the 35 files set `BIBLIO_*` mirror lists at module scope and then
import `dist/`, and those lists are read once at first import. Merging two such files into one
process means the second file's mirror setup never takes effect, so its tests hit the first file's
stub server. Every merge therefore needs one shared stub server whose routing satisfies both
originals — a rewrite of about twenty integration harnesses, each with its own per-test mutable
state, for a 6% suite gain and a real risk of silently weakening coverage.

`--experimental-test-isolation=none` would remove the per-file processes outright, but it gives
every file one shared module registry, which is exactly what the mirror setup depends on not
sharing. Not viable.

The suite stays as it is: 35 files grouped by domain. If the suite ever gets slow enough to
justify the rewrite, the place to start is the installer write-path tests, which dominate it.

## The README-command guard followed the script list

The test that checks every `pnpm <script>` named in the README still exists was watching the wrong
file once the script list moved to `AGENTS.md`: the README is down to two script names
(`preflight`, `selfcheck`), and the other fifteen were unguarded.

The guard now scans both files, so the renamed-script check covers seventeen names instead of two.
Counting the tests: 242 → 243.
