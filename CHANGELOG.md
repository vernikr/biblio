# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [Unreleased]

## [2.2.11] - 2026-10-11

### Changed
- The README cover names what the recent releases changed for the user: a paper a search already
  found is not looked up again when it is opened, a download that meets an unresponsive server
  gives up in seconds instead of hanging past the assistant's patience, and a call with a bad
  argument says which argument. The install section no longer pins artifacts of one particular
  release, which went stale on every subsequent one.

## [2.2.10] - 2026-10-11

### Fixed
- `download_book` and `fetch_book` gave a silent file server up to ten minutes to send response
  headers, while the transfer itself was guarded by a 30 s stall watchdog — so a dead link
  outlived every client waiting on the call (measured: one failure answered after 125 s, two more
  never answered at all). Both phases now share the 30 s budget, still overridable with
  `BIBLIO_DOWNLOAD_TIMEOUT_MS` and `BIBLIO_DOWNLOAD_STALL_MS`.
- A failed download now says which silence killed it — `no response headers within 30000 ms …` or
  `transfer stalled for 30000 ms after N bytes …` — instead of the transport's
  `This operation was aborted`.

## [2.2.9] - 2026-10-11

### Fixed
- The advice `scripts/preflight.mjs` gives when a zod-3-only SDK meets zod 4 named a version
  (3.23.8) that nothing in the project pins. It now names the range the installed SDK declares, so
  it stays right for any pairing.

### Changed
- `src/mirrors.ts` no longer annotates each host with status and latency from a past audit — three
  of those annotations were already false on the day this release was cut. The host order, the
  deliberate absences and their reasons stay; live numbers come from the `healthcheck` tool.

## [2.2.8] - 2026-10-11

### Changed
- Sci-Hub resolutions are reused for the short agent loop: a DOI an enriched `search_papers`
  already resolved is not resolved again by the follow-up `get_paper` (measured: that second call
  made a full extra mirror round trip). Concurrent callers share one resolution, and a miss is
  still asked for again.

### Fixed
- A mirror answering with an oversized page can no longer balloon the process: page bodies are
  read against a 20 MB budget — a declared length is refused before the body is read, a streaming
  body is cut off mid-transfer, and the identity probe reads through the same reader.

## [2.2.7] - 2026-10-11

### Fixed
- A truncated download whose first bytes are a ZIP signature was saved as `.bin`, and a mirror
  sending `Application/PDF` produced no extension at all. File-type sniffing no longer requires
  four bytes before it looks, and reads the content-type header case-insensitively.
- The fix line `--selfcheck` prints for a broken dependency pairing, and the advice
  `scripts/preflight.mjs` gives for it, now name the versions this package pins instead of a
  hand-written pair that drifts on the first dependency bump.

### Changed
- `--selfcheck` lists the tool names it verified, so "my client shows no tools" can be diffed
  against the server's own answer.
- Argument errors are built from the tool's own schema rather than from the SDK's error text: the
  sentences are unchanged, and a reworded SDK upgrade can no longer hand agents raw validation
  output.
- The `test:all` script is gone; `verify:live` already runs the offline gate and the live checks.

## [2.2.6] - 2026-10-11

### Changed
- The README is a page for the person installing, not for the person changing the code: 581 lines
  became 395. The comparison tables moved to `docs/about-this-fork.md`, the development section to
  `AGENTS.md`, the request flow to `docs/architecture.md`, and the roadmap to `docs/STATE.md`.
- `docs/architecture.md` describes the request flow and the three invariants an agent must not
  break, so reading it is cheaper than reading `src/`.
- One recommended launcher everywhere: the README's FAQ no longer offers a second way to start the
  server, and the source installer says that the entry it writes runs the checkout, not the
  published release.

### Fixed
- The check that every documented `pnpm` script exists now scans `AGENTS.md` as well as the README,
  so the script list cannot move out from under it again.

## [2.2.5] - 2026-10-10

### Changed
- The "For AI agents" install steps are shorter and pnpm-free. The agent checks Node, writes `mcpServers.biblio` into `~/.agents/mcp.json` (read by FreeBuff and ZCode) or the config path the user gives, and verifies the eight tools through the client. Claude Code uses `claude mcp add`. The agent no longer runs `--selfcheck` or `--print-config` first; those stay available for debugging.

## [2.2.4] - 2026-10-10

### Changed
- The README no longer documents a pnpm launcher for clients. Install and Quick start give one entry, `npx --yes @vernikr/biblio-mcp@latest`, and one Claude Code command. The release-age and cache flags that the pnpm entry needed are gone with it.

## [2.2.3] - 2026-10-10

### Changed
- `--print-config` writes an npx entry instead of a pnpm one: `command` is the absolute path to `npx`, `args` are `--yes @vernikr/biblio-mcp@latest`, and `env.PATH` lists the folders holding `node` and `npx`. npx resolves `latest` without pnpm's release-age check, so no extra flags are needed.
- The README Quick start is the second block, right after the title and description. Its JSON entry uses npx and has one argument per line. The pnpm launcher stays under Install with its flags.

## [2.2.2] - 2026-10-10

### Fixed
- The `@latest` launcher from 2.2.1 could start an older release for about a day after each publish. pnpm 12 skips versions younger than its minimum release age, so `latest` resolved to 2.0.0. The `--print-config` entry and the README launcher now add `--config.minimum-release-age-exclude=@vernikr/biblio-mcp`, which exempts only this package. Other packages keep the check.
- 2.2.1 shipped the same launcher without that exclude. Use 2.2.2 for the fix.

## [2.2.1] - 2026-10-10

### Changed
- `--print-config` writes a launcher that always fetches the newest release: `pnpm --silent --config.dlx-cache-max-age=0 dlx @vernikr/biblio-mcp@latest`, plus the release-age exclude added in 2.2.2. Previously it pinned the version of the copy that printed it. Existing pinned entries keep working.
- The README install steps and the agent runbook use `@latest` with the same cache flag, for pnpm and npx. Pin an explicit version only to reproduce a release.

## [2.2.0] - 2026-10-10

### Added
- `fetch_book`: one call from a title to a saved file. It searches, ranks the copies (requested format, then PDF, then the largest), tries up to `max_attempts` (1–5, default 3) and saves the first copy that verifies. It returns `picked`, `attempts` and a `nextStep` when nothing could be saved.
- `download_book` failures list `alternatives`: other copies of the same title, ranked, with a `nextStep` telling the agent to retry with one of their MD5s instead of a shell workaround.

### Changed
- `download_book`'s `output_dir` is optional and defaults to `~/Downloads/biblio-mcp`. Argument errors name only the fields that are actually missing.
- The save-to-disk path moved into `src/acquire.ts`; behaviour of direct downloads is otherwise unchanged.

## [2.1.1] - 2026-10-10

### Changed
- The README opens with a self-contained "For AI agents" section, so the npm page alone is enough for an agent asked to connect the package through pnpm. `docs/agent-install.md` now points there.

## [2.1.0] - 2026-10-10

### Added
- `--print-config` prints a ready MCP client entry that launches the pinned release through pnpm, with a PATH that GUI-started clients can use. It writes nothing and never starts the server.
- `docs/agent-install.md`: a runbook for agents asked to connect the package through pnpm.

### Fixed
- `get_download_links` and `download_book` report unavailable sources as an error instead of an empty success. Sources that have no record are listed as `notFound`; partial results keep their `errors`.
- A Sci-Hub mirror that answers without a PDF no longer blocks a mirror that has the PDF, and is not put into cooldown.
- `BIBLIO_DOWNLOAD_TIMEOUT_MS` is documented as the response-header budget; a steady transfer longer than it completes, guarded by `BIBLIO_DOWNLOAD_STALL_MS`.
- `book_details` no longer marks a total failure with `resolvedVia`.

### Changed
- Tools carry MCP annotations: lookups are read-only, `download_book` is marked as writing a new file (not idempotent), and every tool is open-world. `get_download_links` is deliberately not read-only, because resolving member links can spend quota.
- Test suite: examples in tool descriptions are checked with the SDK's AJV validator; `isUsefulLink` tests are pure and live in `parse.test.mjs`.

## [2.0.0] - 2026-10-09

### Published distribution
- Updated GitHub Actions to current stable Node-24-compatible releases; launcher acceptance distinguishes first registry bootstrap from warm offline reuse.
- Published `@vernikr/biblio-mcp@2.0.0`; cold public-registry npx/pnpm launchers are verified. One compiled stdio runtime for npm and MCPB; source installer remains a developer utility, not a consumer prerequisite.

- Runtime support is now Node 22+ (user-approved); CI targets 22/24 LTS.
- Updated SDK 1.32.1, Zod 4.6.5, Cheerio 1.2.0, TypeScript 7.0.2, tsx 4.23.15 and Node 22 types. The SDK update fixes GHSA-6qxp-vccf-f47h; production audit is clean.
- Adapted readable validation to the newer SDK diagnostic format without a second schema parse.

## [1.8.0] - 2026-10-08

### Performance
- `search_books` caches each `(source, query, limit)` outcome for 45 seconds (including concise failures); repeated agent-loop searches reuse results instead of retrying slow mirrors.
- Libgen `ads.php` HTML is cached by MD5 for 45 seconds and shared between `book_details` and download-link resolution. Anna's HTML details are skipped while all its mirrors are cooling down.
- Libgen search requests now ask for `clamp(limit × 3, 25, 100)` rows. Legacy route fallbacks are attempted on the same mirror after HTTP 404/405 rather than launching a second full mirror race.
- Anna's result comment markers are stripped in one pass; tool argument validation now formats the SDK's existing issues without parsing the same schema twice. Health probes cancel bodies they do not inspect.
- Added opt-in `pnpm run benchmark`; the offline test runner uses four workers on Node 18.9+ while preserving support for earlier Node 18 releases.

### Benchmarks (one live run; mirror latency varies)
- Using `scripts/benchmark.mjs`, warm `search_books` measured **3119 ms → <1 ms**; warm `book_details` measured **458 ms → 19 ms**; `get_download_links` measured **600 ms → 9 ms**.
- Cold `search_books` and `book_details` remained network-bound and varied between runs; the warm-cache targets (≤800 ms and ≤700 ms) were met in this sample.
- Full offline test execution measured **20.2 s for 131 tests before** and **10.9 s for 132 tests after** adaptive concurrency. The plan's <5 s target remains unmet locally; intentional timeout tests and child-process integration tests account for much of the remaining time.

## [1.7.0] - 2026-10-08

### Fixed
- `book_details` queries Anna's Archive and Libgen concurrently, skips Anna's HTML details while all mirrors are cooling down, and shortens repeated provider failures with a process-lifetime circuit breaker.
- `healthcheck` clears cooldowns without forgetting the preferred mirror; every mirror group now has a positive site-identity marker.
- `download_book` preserves successful files whose name matches the staging name and warns explicitly when the downloaded MD5 differs from the requested one.
- `parseSize` uses correct TB conversions, and Z-Library metadata uses the shared year/format/size validators.
- `search_books` rejects empty source lists and de-duplicates repeated source names; source errors are concise and progress-notification failures are best-effort.
- The installer honors `--live`, `src/index.ts` no longer recommends the upstream npm executable, and the default agent test suite stays offline.

## [1.6.0] - 2026-10-08

### Fixed
- `search_papers` now separates the article title from the bold journal/issue block and keeps the journal name in `journal`.
- API-issued Anna's Archive member links survive the MD5 filter even when signed URLs contain no MD5; scraped unrelated links remain filtered.
- Empty mirror lists fail immediately with the corresponding `BIBLIO_*_MIRRORS` setting named in the error.
- HTML request timeouts remain active through full response-body consumption, including error bodies and HTML download interstitials.
- The installer no longer falls back to `npm` in a checkout with a `pnpm-lock.yaml`; it stops and asks for pnpm.

### Added
- Offline regression tests for the four critical fixes, including locally served captured provider pages and stalled response bodies.

## [1.5.2] - 2026-10-08

### Added
- Strict TypeScript guardrails, including unchecked-index checks and typechecking for scripts.
- Separate opt-in live integration tests; the default test suite stays offline, and CI reports live mirror checks in a non-blocking job.
- Four provider pages captured from live Libgen/Sci-Hub responses, offline fixture-content and SHA-256 drift checks, and `pnpm run fixtures:capture` to refresh them safely.

### Fixed
- Removed the unused Anna's Archive HTML parse, and removed dead imports surfaced by strict compiler checks.

## [1.5.1] - 2026-10-08

Found by auditing the release rather than by a bug report: three things were inconsistent with
what the documentation promised.

### Fixed
- **`--selfcheck` failed for every installed copy of the package.** Two preflight checks are about
  the *source checkout*, not the package: a published tarball ships no `pnpm-lock.yaml` and has no
  `node_modules` of its own. Both were reported as failures, so `--selfcheck` printed
  `FAIL lockfiles` and `FAIL dependencies — run pnpm install` for anyone who installed rather than
  cloned — advice that cannot help them. `lockfiles` now reports `n/a (installed package)` in that
  case, and `dependencies` also looks in the consuming project's tree, two levels up. Verified
  against a real `npm pack` tarball installed with `npm install`.
- **The published tarball did not contain the installer.** The README's primary install path is
  `node scripts/install.mjs`, but `files` in `package.json` listed only `preflight.mjs`, so the
  documented command was missing for anyone who installed the package.

### Changed
- **`--help` now lists `BIBLIO_ANNAS_API_KEY` and the installer.** Both existed and were
  documented elsewhere, but not in the one place a user looks first.

### Added
- **Three drift guards**, so this cannot quietly recur: every `BIBLIO_*` variable referenced in
  `src/` or `scripts/` must appear in both `--help` and the README; every `pnpm <script>` the README
  mentions must exist in `package.json`; and if the README points at `scripts/install.mjs`, the
  tarball must ship it.
- A preflight test that reproduces the installed-package layout and asserts it passes.

## [1.5.0] - 2026-10-08

Phase 4 of the improvement plan: release and distribution. The goal is that nobody installs
this into a state where it starts but cannot serve.

### Added
- **`scripts/install.mjs` — one-command installer.** Checks prerequisites, obtains the source,
  runs preflight, installs, builds, verifies the tool surface in-process, and prints (or with
  `--write-config`, writes) the MCP client config. It is plain JavaScript with no dependencies
  and no imports from `src/` or `dist/`, so it runs before anything is installed. It writes
  atomically with a `.bak`, and **refuses to touch a config it cannot parse** — destroying a
  working client config to install a book downloader would be a bad trade. `--dry-run` shows
  every step without writing.
- **A startup guard.** Before binding stdio, the server exercises its own tool surface over an
  in-memory transport: it lists the tools and makes one `tools/call` with a deliberately invalid
  argument. A healthy server answers with a validation error; a server with the broken
  `@modelcontextprotocol/sdk` 1.12.1 + `zod` 4 pairing crashes inside its own validator. When
  that happens the server now **refuses to start**, exits non-zero, and prints the exact fix
  command to stderr. `BIBLIO_SKIP_STARTUP_CHECK=1` bypasses it in an emergency.
- **Dependabot policy** (`.github/dependabot.yml`): `zod` and `@modelcontextprotocol/sdk` are
  grouped into a single PR, and major bumps of either are ignored. Those two packages decide
  each other's compatibility, so they must be reviewed as one change — that is precisely how the
  original breakage was produced, by two individually reasonable bumps.
- **Two CI steps**: an installer dry run, and a check that the startup guard genuinely refuses
  the broken pairing (reproduced in a throwaway tree with `sdk@1.12.1` + `zod@4.4.3`, asserting
  a non-zero exit, `refusing to start` on stderr, and that the fix is named).

### Fixed
- **The exit code was discarded in server mode.** `main()` returned 1 but the `.then` handler
  only set `process.exitCode` when a `--flag` was present, so a server that refused to start
  looked like a clean exit to the client. A non-zero result is now always propagated.
- **The version could be read from the wrong `package.json`.** `SERVER_VERSION` read
  `../package.json` relative to `dist/`; copying `dist/` into another project reported *that*
  project's version (observed as a build advertising `v1.0.0`). The manifest's `name` is now
  checked, and a mismatch reports `0.0.0-unknown` rather than a plausible wrong number.
- **Overriding `validateToolInput` crashed on SDK versions that do not have it.** The override
  called `.bind` on `undefined`, producing `Cannot read properties of undefined (reading 'bind')`
  at startup — exactly the kind of unactionable message this fork exists to remove. It now no-ops
  when the method is absent, leaving the SDK's own (worse but correct) error wording.

### Documentation
- The publication question is now answered in the README rather than left ambiguous: this fork is
  **not** published to npm, why not, and what to run instead. The previous state — an npm package
  exists but the instructions say not to use it — was worse than either option.

## [1.4.0] - 2026-10-08

Phase 3 of the improvement plan: the agent experience. Nothing here changes what the tools
find; it changes how quickly a caller that has never seen the source code can use them
correctly.

### Added
- **`healthcheck` tool.** Reports per-mirror status and latency for every source without
  querying a catalogue, so it is cheap enough to call before a search. Distinguishes "the
  network is blocked" from "the query matched nothing", which look identical from the caller's
  side otherwise. A host that answers but is not the site it claims to be is reported under
  `impostors` rather than as reachable. The tool surface is now seven tools.
- **A call example in every tool description** (`Example: {"query":"dune frank herbert","limit":5}`).
  One MCP bridge advertised `search_books` as taking no parameters at all; an example in the
  schema costs nothing and works in every client. Examples are generated from a single
  `TOOL_META` table in `src/toolmeta.ts` and tested to be valid JSON that satisfies each tool's
  own required-argument list.

### Changed
- **Argument-validation errors are sentences.** A failed call used to return zod's issue array
  (`[{"expected":"string","code":"invalid_type","path":["output_dir"],...}]`). It now returns
  `download_book: "md5" is missing; "output_dir" is missing. It needs an "md5" (32-character hex
  hash) and an "output_dir" (absolute path to a directory). Optional: "filename". Example: {...}`.
  Implemented by replacing `McpServer.validateToolInput` on the instance — the SDK calls it as
  `this.validateToolInput(...)`, so no subclassing or patching is needed. Unrecognised error
  shapes fall through to the original message, so this cannot make an error less informative.
- **`output_dir` resolves against `$HOME`, not the server's working directory.** The previous
  behaviour resolved relative paths against `process.cwd()` — wherever the client happened to
  launch the server, which the caller cannot see. The response now always includes the resolved
  absolute `outputDir`, plus a `note` when the input was relative. An empty `output_dir` is
  rejected at validation instead of silently meaning the current directory.

### Notes for maintainers
- `healthcheck` was added to `REQUIRED_TOOLS` in **both** `src/selfcheck.ts` and
  `test/server.test.mjs`. The two lists are separate on purpose (the selfcheck must not import
  the test suite) but they must be updated together.
- A tool with no required arguments omits `required` from its JSON Schema entirely rather than
  publishing an empty array. Tests must accept `undefined`.

## [1.3.0] - 2026-10-08

Phase 2 of the improvement plan: report what a page actually says. Every fix below was designed
against live captured markup rather than a hand-written fixture, because the fixture was what
hid the bugs in the first place.

### Fixed
- **`author` is the author again.** The Libgen parser read the first table column, but that
  column combines series, title and ISBNs while the author is the second — so every result
  reported `Wiley Finance 9780471460671; 0471460672 …` as its author. Columns are now resolved
  from the table's `<th>` header row, with a positional fallback for mirrors that ship no header.
- **`title` no longer carries the series and the ISBNs.** Taking "the longest anchor text" in
  that first column concatenated three different fields into one string. `series` is now its own
  field (`Book.series`) and ISBNs are read from their own anchor.
- **A digit run can no longer be reported as a file size.** The size regex was unbounded, so it
  matched `00264mB` out of concatenated page text. `parseSize` is bounded at both ends, rejects
  leading zeros, and refuses values above 100 TB.
- **`book_details` no longer depends on a source that refuses the request.** Anna's Archive is
  tried first, but its genuine mirrors answer HTTP 403 to scraped HTML pages from non-browser
  clients, so the tool usually returned an empty title and no links. Libgen is now the fallback,
  and it is the better source: its `ads.php` page embeds a **BibTeX block** with exact
  title/author/publisher/ISBN/year/series, so nothing is guessed. Responses report `resolvedVia`
  and `annasUnavailable`, and if both sources fail the caller gets an empty record naming both
  failures instead of an exception.
- **Download links that cannot lead to the file are filtered out.** Libgen's `ads.php` page links
  the bare `http://annas-archive.org/` homepage, which `get_download_links` reported as a
  download option; an agent that followed it got nothing and no explanation. A link is now only
  reported if it has a path beyond the domain root and references the requested MD5 (IPFS gateway
  links excepted, since they carry a CID). Applied in both `resolveDownloads` and
  `libgen.details`, because `book_details` embeds the latter directly.

### Added
- **`src/parse.ts`** — pure, I/O-free parsing helpers shared by the providers: `parseSize`,
  `parseYear`, `parseFormat`, `parseLanguage`, `parsePages`, `isIsbnLike`, `parseIsbns`,
  `columnMap`, `LIBGEN_DEFAULT_COLUMNS`, `parseBibtex`, `isUsefulLink`.
- **`libgen.details(md5)`** — resolves metadata from the BibTeX block on `ads.php`, reusing the
  same response for the download links so it costs one request, not two.
- **`Book.series`** — the series name, kept separate from the title.
- **`BookDetailsResult.resolvedVia` / `.annasUnavailable` / `.libgenUnavailable`** — so a caller
  is never left wondering which source answered or why one did not.
- **`test/parse.test.mjs`, `test/details.test.mjs`** — 27 new tests. The suite is 60 tests, all
  passing, and no longer has any `todo` placeholders.

### Changed
- The Libgen search fixture (`test/fixtures/libgen-search.html`) now mirrors the real page:
  `<th>` header row, `<b>` series, `edition.php` title anchors, the ISBN anchor, and the badge
  spans. The previous hand-written fixture did not have these, which is why the parser looked
  correct in tests while being wrong in production.
- `annas.parseMeta` delegates to the shared validators instead of keeping its own looser copies.

### Notes for maintainers
- Provider tests that need different mirrors **must run in a child process**. `ANNAS_MIRRORS` /
  `LIBGEN_MIRRORS` are read once, at module evaluation, and busting the ESM cache with a `?t=N`
  query does not help: a freshly evaluated `providers/index.js` still statically imports the
  already-cached `mirrors.js`. `test/details.test.mjs` documents this and provides
  `runInProcess()`. Writing those tests with in-process env overrides produced tests that
  silently exercised the live internet.

## [1.2.0] - 2026-10-07

First release of the maintained fork. Phases 0–1 of the improvement plan: make the install
impossible to get silently wrong, and make the network layer fast and honest.

### Fixed
- **Hijacked mirrors are no longer trusted.** `annas-archive.li` was taken down under publisher
  pressure in 2026-03 and now answers HTTP 200 in ~0.15 s with a ~27 kB page of advertising
  JavaScript and no `<title>` — faster than every genuine Anna's Archive mirror, so it won the
  race and the parsers turned an ad page into "zero results, no error". Providers now pass a
  content validator to `fetchFromMirrors`, such a host is rejected with an explicit reason and
  cooled down, and `--selfcheck` reports it as `HTTP 200 — NOT the expected site` rather than as
  healthy. The registry drops `.li` and `.gs` and adopts upstream's audited `.gl, .gd, .pk`.
- **The server can no longer install into a state where it starts but cannot serve a single
  request.** `@modelcontextprotocol/sdk` is pinned to `1.29.0`, which declares
  `zod: "^3.25 || ^4.0"`. The previous pairing (`sdk@1.12.1`, whose peer range is `^3.23.8`,
  against `zod@4.4.3`) passed `tools/list` and then failed every `tools/call` with
  `keyValidator._parse is not a function`.
- **Removed `package-lock.json`.** It resolved `sdk@1.12.1` against `zod@4.4.3` — the broken
  pairing — while `pnpm-lock.yaml` resolved the working one, so `npm ci` and `pnpm install`
  produced different servers. One lockfile, one answer.
- **Search latency.** A failed mirror is now skipped for a cooldown window instead of being
  retried on every request, and mirrors are tried concurrently with a head start rather than
  sequentially. The same query that took 14.2 s against the previous mirror list now takes
  ~1.0 s, because it no longer pays four timeouts for dead Z-Library hosts.
- **`BIBLIO_TIMEOUT_MS` no longer applies to file downloads.** One 20 s budget made page
  scraping far too patient and downloads far too strict; downloads now get
  `BIBLIO_DOWNLOAD_TIMEOUT_MS` (600 s) plus a stall watchdog.
- **`download_book` no longer saves an HTML page as if it were a book.** Libgen's `get.php`
  serves an interstitial when its one-time key expires; that response is now detected and the
  next candidate link is tried.
- **CI can now tell a working server from one that merely starts.** The smoke check sends a real
  `tools/call` (with a deliberately invalid argument) instead of only `initialize` and
  `tools/list`, both of which succeed on a broken build.

### Added
- `scripts/preflight.mjs` — offline install guard. Checks Node version, lockfile, dependencies,
  the zod/SDK pairing, and the build artefact; on failure it names the symptom and prints the
  command that fixes it. `pnpm preflight`.
- `--selfcheck` — runs preflight, constructs the server and lists its tools over an in-memory
  transport, probes every mirror with timings, and with `--live` performs one real search.
  `pnpm selfcheck` / `pnpm selfcheck:live`.
- **Streaming downloads.** `download_book` writes to disk as it goes, so peak memory no longer
  scales with file size, writes via a `.part` file that is renamed on success, and returns the
  **MD5 of what was written** with `md5MatchesRequest` so a caller can confirm the file is the
  catalogue entry it asked for.
- **Progress notifications** during downloads, so a long transfer does not look like a hung
  request. (Clients must pass `onprogress` and `resetTimeoutOnProgress: true` to benefit —
  documented in the README.)
- Test suite on Node's built-in runner: format sniffing, mirror rotation and the negative cache,
  half-open recovery, streaming downloads including stall and interstitial handling, the tool
  surface over an in-memory transport, and the preflight guard against a real synthetic broken
  tree. No test framework to install; network paths are tested against local servers.
- `--version` and `--help`; all environment variables are listed in `--help` and the README.
- `BIBLIO_DISABLE_SOURCES`, `BIBLIO_DOWNLOAD_STALL_MS`, `BIBLIO_MIRROR_DEAD_TTL_MS`,
  `BIBLIO_MIRROR_STAGGER_MS`, `BIBLIO_DOWNLOAD_TIMEOUT_MS`.

### Changed
- **Z-Library is no longer searched by default.** Every public domain in the built-in list was
  unreachable at the 2026-10-07 mirror audit, so including it added latency and an error the
  caller could not act on. Pass `sources: ["zlibrary"]` to include it.
- **Mirror registry re-audited** and `ZLIBRARY_MIRRORS` moved into `src/mirrors.ts` from
  `src/providers/zlibrary.ts`, restoring the "one file to edit" contract. Added `libgen.bz`;
  demoted hosts that were unreachable. Order is now preference, with unreachable hosts last
  rather than deleted.
- **Package manager is pnpm** (`packageManager` field added); scripts and CI use it.
- Server internals split into `server.ts` (tool definitions), `selfcheck.ts` (health checks) and
  `sniff.ts` (format detection) so each can be exercised without binding a transport.
- Tool descriptions now state which sources are actually searched, and `download_book` documents
  its checksum and progress behaviour.

### Known issues (tracked for phase 2)
- `book_details` usually fails: the genuine Anna's Archive mirrors return HTTP 403 to the
  scraped HTML pages from a non-browser client (their DDoS-Guard challenge). It now reports the
  403 instead of parsing whatever came back. `BIBLIO_ANNAS_API_KEY` enables the member
  fast-download JSON API, which is not behind the challenge.
- Libgen `author` comes from the wrong table column, so it reports the series name and ISBNs.
- Both are pinned with `todo` tests describing the intended behaviour.

[Unreleased]: https://github.com/vernikr/biblio-mcp/compare/v2.2.11...HEAD
[2.2.11]: https://github.com/vernikr/biblio-mcp/compare/v2.2.10...v2.2.11
[2.2.10]: https://github.com/vernikr/biblio-mcp/compare/v2.2.9...v2.2.10
[2.2.9]: https://github.com/vernikr/biblio-mcp/compare/v2.2.8...v2.2.9
[2.2.8]: https://github.com/vernikr/biblio-mcp/compare/v2.2.7...v2.2.8
[2.2.7]: https://github.com/vernikr/biblio-mcp/compare/v2.2.6...v2.2.7
[2.2.6]: https://github.com/vernikr/biblio-mcp/compare/v2.2.5...v2.2.6
[2.2.5]: https://github.com/vernikr/biblio-mcp/compare/v2.2.4...v2.2.5
[2.2.4]: https://github.com/vernikr/biblio-mcp/compare/v2.2.3...v2.2.4
[2.2.3]: https://github.com/vernikr/biblio-mcp/compare/v2.2.2...v2.2.3
[2.2.2]: https://github.com/vernikr/biblio-mcp/compare/v2.2.1...v2.2.2
[2.2.1]: https://github.com/vernikr/biblio-mcp/compare/v2.2.0...v2.2.1
[2.2.0]: https://github.com/vernikr/biblio-mcp/compare/v2.1.1...v2.2.0
[2.1.1]: https://github.com/vernikr/biblio-mcp/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/vernikr/biblio-mcp/compare/v2.0.0...v2.1.0
[1.8.0]: https://github.com/vernikr/biblio-mcp/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/vernikr/biblio-mcp/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/vernikr/biblio-mcp/compare/v1.5.2...v1.6.0
[1.5.2]: https://github.com/vernikr/biblio-mcp/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/vernikr/biblio-mcp/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/vernikr/biblio-mcp/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/vernikr/biblio-mcp/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/vernikr/biblio-mcp/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/vernikr/biblio-mcp/compare/v1.1.0...v1.2.0

## [1.1.0] - 2026-07-09

### Fixed
- **Sci-Hub PDF resolution** — added mirrors (`sci-hub.ren`, `sci-hub.mksa.top`, `sci-hub.hkvisa.net`) that embed PDF URLs even behind captcha pages; PDFs now resolve reliably via `sci.bban.top` CDN
- Strip `#view=FitH` fragment from resolved PDF URLs for cleaner direct downloads
- `repository.url` format in package.json (silences npm publish warning)

### Added
- CI status, npm version, and license badges in README

<!-- 1.1.0 and 1.0.0 are upstream releases, so their links point at the upstream
     repository on purpose: that is where those versions were published. -->
[1.1.0]: https://github.com/yashimosh/biblio-mcp/compare/v1.0.0...v1.1.0

## [1.0.0] - 2026-07-08

Initial release.

### Added
- `search_books` — fan-out search across Anna's Archive, Libgen, and Z-Library, deduped by MD5
- `book_details` — full metadata for a book by MD5
- `get_download_links` — resolvable download URLs for an MD5 (Libgen direct, Anna's partner servers, IPFS gateways)
- `download_book` — fetch a file to a local directory by MD5
- `search_papers` — academic paper search via Library Genesis scimag
- `get_paper` — resolve a paper's PDF via Sci-Hub by DOI, URL, or title
- Mirror rotation with per-host stickiness and env var overrides for every source
- Per-source fault isolation via `Promise.allSettled`

[1.0.0]: https://github.com/yashimosh/biblio-mcp/releases/tag/v1.0.0

[2.0.0]: https://github.com/vernikr/biblio-mcp/compare/e07743a...main
