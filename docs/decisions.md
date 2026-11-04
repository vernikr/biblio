# Design decisions

This file keeps the rationale for non-obvious behavior out of implementation comments.

## Mirror requests

- Timeout and cooldown budgets stay positive; only mirror staggering accepts zero to start all attempts together. Empty Z-Library mirror errors name the actual `BIBLIO_ZLIB_MIRRORS` override.
- Mirror order is a preference, not a fail-fast sequence. Start candidates with a small stagger, accept the first response whose body and identity check pass, and cancel losers. Within one mirror, try a route fallback only after HTTP 404/405.
- Remember failed mirrors for a short cooldown, but retry the full group when all candidates are cooling down. Preserve the last successful mirror as preferred; `healthcheck` clears cooldowns without discarding that preference, while `selfcheck` resets both.
- A successful status code is not proof of site identity. `healthcheck`/`selfcheck` use per-group content markers; Anna's scraped requests also pass an identity validator. Provider fetch validators remain provider-specific, and Sci-Hub human-check pages are rejected by its validator (audit item A16); they are never solved.
- `AbortSignal.any` is used when available; the historical fallback is retained for now, but Node 22+ no longer needs it.

## Timeouts and downloads

- The HTML request budget covers body consumption, not just response headers. Large file downloads have a separate budget and an idle stall watchdog.
- `BIBLIO_DOWNLOAD_TIMEOUT_MS` bounds only the time a file server takes to answer with headers. Once bytes flow, `BIBLIO_DOWNLOAD_STALL_MS` is the only limit, so a steady transfer longer than the header budget completes. A total-body deadline was rejected: it would cut off legitimate large downloads on slow links.
- A 2xx page that lacks the requested record (for example a Sci-Hub page with no PDF) is a record miss, not a dead mirror: it does not cool the host down, and another mirror may still win the race. A challenge page is a mirror failure. If every answer is a miss, the result is not-found; if a challenged mirror was among them, the result is unavailable, because the challenged mirror's record state is unknown.
- Tool annotations describe what the tool does to the outside world. Read-only is claimed only for catalogue lookups and mirror probes; member-link resolution and file writes are not read-only.
- Download lookups separate three outcomes. Links found, possibly beside a failed source, are returned with `errors`. Sources that answered "no record" are listed as `notFound` and are not errors. An empty result while any source was unavailable is an error, since absence is then unproven.
- Downloads stream through a hash transform to a `.part` file and are published only after a complete transfer. Reject HTML interstitials instead of saving them as books; report the actual MD5 because mirror links can serve a different file.
- Probe requests without an identity marker cancel unread bodies so health checks do not leave connections open.

## Provider parsing and data

- Parser behavior is grounded in captured provider pages under `test/fixtures/`. Those fixtures are checksum-guarded; do not replace unavailable live HTML with guessed markup.
- Libgen columns are mapped by headers where possible, with a positional fallback for pages without headers. Shared strict validators reject implausible years, sizes, formats, languages, and ISBNs. Details prefer Libgen's BibTeX block over heuristic page text.
- Anna's pages are identity-checked because a parked domain can return a fast HTTP 200. Its scraped metadata is heuristic; the member JSON fast-download endpoint is separate from the HTML path and is enabled only by an environment key.
- Book details race Anna's Archive and Libgen when possible, returning the first usable record; Libgen's structured BibTeX is the reliable metadata fallback. Metadata and links reuse one `ads.php` response.
- Download candidates must point to a specific record (a non-root path and, except for IPFS gateways, the requested MD5); bare homepages are not usable download links.
- Z-Library is off by default because audited public domains were unusable; users can opt in with `sources: ["zlibrary"]` and a working `BIBLIO_ZLIB_MIRRORS` value.
- Tests that override module-level mirror lists use a fresh Node subprocess so environment values are set before the provider graph is imported; ESM query-string cache busting would not refresh its static dependencies.

## Caches and source health

- Provider caches are bounded and process-local. They share in-flight work, start the TTL after a successful load, update LRU order on hits without extending TTL, and never retain thrown failures. Search caches may retain concise failure outcomes briefly to avoid repeating an immediately adjacent failing source call.
- Source-level circuits open after three consecutive real failures and close again after the same cooldown as mirrors (`BIBLIO_MIRROR_DEAD_TTL_MS`, default five minutes). "Record not found on every mirror" is a healthy answer and never counts. A single missing record never cools a mirror down; only network errors, server errors, challenges, and identity failures do.
- The Anna's member key is sent only to hosts whose homepage passes the identity marker, checked without the key and cached for ten minutes.

## MCP surface and startup

- Startup and offline selfcheck share one tool-surface check: required tools plus the expected invalid-MD5 validation response, not any arbitrary `isError`. Default `verify` builds once and stays offline; live mirror/search checks are explicit. CI drives stdio through the SDK rather than grepping unrelated tools-list text.
- Call examples are manually curated; required/optional field hints come from the registered Zod input schema so validation guidance cannot drift from the tool definition.
- Validation issues are taken from the SDK's original single schema parse. Do not re-parse invalid arguments to format an error.
- Selfchecks use one in-memory MCP client/server lifecycle helper. `selfcheck` verifies preflight, tool registration, mirror reachability, and optionally a real search; startup checks exercise an invalid call before stdio is bound. `--selfcheck --offline` skips mirror/network stages; ordinary selfcheck and `--live` retain them.
- Healthcheck and selfcheck share `probeGroup`, keeping reachability, latency, and impostor summaries consistent.
- `search_papers` resolves direct Sci-Hub PDF URLs only when `resolvePdfs` is explicitly enabled, and caps enrichment at three DOI results. Automatic per-result network lookups would make an otherwise fast catalogue search unexpectedly slow; lookup failures therefore leave the Libgen results intact.

## Installation and project size

- The user approved a Node 22+ runtime floor for the scoped distribution. Engines, installer and preflight agree; CI covers 22/24 LTS and smoke-checks 22.0. This allows current Cheerio and removes old test-runner compatibility branches. `docs:env` rebuilds before reading compiled settings so its output reflects changed source.
- A checkout with `pnpm-lock.yaml` must stop when pnpm is missing; silently falling back to npm can produce a different dependency tree. After prerequisite checks, install with `--frozen-lockfile` before running the dependency preflight; an incompatible SDK/Zod pair must still stop the build.
- MCP config writes validate the root object and any existing `mcpServers` object before touching the file or its backup. Create a missing `mcpServers`, never silently replace an invalid value; preserve other entries. Successful writes use a backup and atomic rename.
- Preflight checks the SDK's Zod range and runtime internals because an incompatible pair can answer `tools/list` but fail every `tools/call`. It locates package manifests by filesystem path before resolving an entry point, since `exports` can hide `package.json`; installed-package checks use the consumer's lockfile and dependencies.
- The user approved a separate npm identity `@vernikr/biblio-mcp`; upstream's name is never used for publication. Prepare artifacts without claiming registry publication; authenticate scope rights before publishing. npm and MCPB contain identical compiled runtime bytes, with no consumer build tools. MCPB uses a hoisted production deployment because ZIP-flattened pnpm symlinks otherwise break transitive dependency resolution.
- The acceptance priority is a green `pnpm run verify`, not deleting fixtures or regression tests
to satisfy a raw line-count target.

## Wave 2 audit follow-up

- **Sci-Hub human checks are reported, not solved.** A Sci-Hub mirror can answer HTTP 200 with an ALTCHA verification page instead of the article. The provider recognises that page, treats it as a failed mirror, and tries the next one. If every mirror asks for the check, the caller gets an error that advises trying again later. Getting past the check would mean defeating the site's protection, and its legal status depends on the user's country, so the server never attempts it. An article page without a PDF is "not found", not success.
- **The member API key goes only to hosts that pass the identity check.** The Anna's Archive fast-download key is a credential. It is sent only to mirrors whose home page carries the site's marker, so a look-alike host cannot collect it. The key stays in the query string because the documented API accepts only that form.
- **A losing Anna's request is cancelled; a losing Libgen request is not.** Once Libgen answers first, the slower Anna's detail request is cancelled, and that cancellation does not count against the Anna's circuit. Libgen's ads page is cached and reused by the download step, so cancelling it would waste work the next call needs.
- **Member links race the verified mirrors.** Each verified mirror is asked at once, the first usable answer wins, and the rest are cancelled. Sequential tries cost one full timeout per dead mirror.
- **Not-found responses are health, not failure.** A 404 or "no such record" answer proves the source responded. It does not open a mirror's cooldown or a source's circuit. Real failures still do.
- **A caller's filename is never overwritten.** Publish a caller-chosen name with an atomic hard link from unique same-directory staging, so a file created during the transfer is refused too. Without hard-link support, fail rather than fall back to `rename`; a publication failure must not re-download from another URL. Default catalogue-MD5 names retain their replacement behavior. Unique staging keeps concurrent calls from writing or deleting each other's temporary bytes.
- **One settings registry and one tool-description source.** Every `BIBLIO_*` setting is listed once in `src/config.ts`, and the README table is generated from it. Each tool's text and example live together in `src/toolmeta.ts`, and a test checks each example against its schema. Argument text stays in the Zod schemas.
- **The installer's end-to-end test runs a real build and stays in the default suite.** Cutting it would make the suite faster but would drop coverage of the actual install path, so it stays. The cost is about five seconds of the roughly fifteen-second suite.
