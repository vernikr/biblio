# biblio-mcp

[![CI](https://github.com/vernikr/biblio-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/vernikr/biblio-mcp/actions/workflows/ci.yml)
[MIT license](LICENSE)

**One [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that searches Anna's Archive, Library Genesis (Libgen), Sci-Hub, and Z-Library — all at once.**

Search millions of books, academic papers, and research articles across every major shadow library through a single unified interface. Resolve download links and fetch files directly from your AI assistant — Claude Code, Claude Desktop, Cline, Cursor, or any MCP-compatible client.

No API keys. No login. No per-source servers to juggle. One server for all four sources.

## Quick start

Add this entry to your MCP client's config. It works in any client that can launch a stdio
server: Claude Code, Cursor, Cline, or Claude Desktop through its config file.

```json
{
  "mcpServers": {
    "biblio": {
      "command": "npx",
      "args": [
        "--yes",
        "@vernikr/biblio-mcp@latest"
      ]
    }
  }
}
```

Requires Node 22+; npx comes with it. Restart the client, turn the `biblio` server on, then call
`healthcheck`. `@latest` fetches the newest release each time the client starts.

If the client starts from the Dock and says it cannot find `npx` or `node`, add an `env` block with
a `PATH`. Run `npx --yes @vernikr/biblio-mcp@latest --print-config` and copy its entry: it has the
absolute path to `npx` and a `PATH` that lists the folders holding `node` and `npx`.

- **Claude Desktop:** install the newest `vernikr-biblio-mcp-*.mcpb` from the
  [releases page](https://github.com/vernikr/biblio-mcp/releases) through Settings → Extensions
  (Install Extension), review permissions and optional settings. No Git, pnpm or build step.
  The host's Node runtime must meet the extension's Node 22+ requirement.
- **Other options:** the prepared npm tarball or the printed entry; see [Install](#install).
- Downloads go to the `output_dir` you pass to the tool (default `~/Downloads/biblio-mcp`), never
  the install/package-manager cache.

---

<!-- cover:start -->
## Why this fork

The idea is the same as the original: one tool that lets your AI assistant find books and
research papers across the shadow libraries and get them for you. This fork is about making
that something you can rely on.

- **No checkout or build for end users.** The prepared npm package and Desktop extension use
  the same checked runtime. A broken setup is caught before requests are served, with the fix
  spelled out. The checkout installer preserves invalid client configuration and backups.
- **Faster answers.** Searches come back many times faster, because the server stops waiting on
  websites that are no longer there — and a paper a search has already found is not looked up
  again when your assistant opens it.
- **Honest results.** A source that is down is reported, not silently dropped — and one that
  answered with links is never reported as down. A website that has stopped being the real
  library is refused, and a page that asks you to prove you are a human is reported as such,
  not handed over as the book. Downloaded files are checked, so you know you got the right
  book. Files you name explicitly won't replace an existing file, and a name your operating
  system would reject or silently change is refused before anything is written.
- **Cleaner information.** Titles, authors and formats come from the right fields, and broken
  or useless links are filtered out.
- **Less time lost.** When something goes wrong, the message says what happened and what to do
  next: a call with a bad argument names the argument and shows a working example, a download that
  meets an unresponsive server gives up in seconds instead of hanging until your assistant times
  out, and a failed `fetch_book` names the other copies its search already found. A one-call
  health check tells you whether anything is reachable at all, and empty searches are stopped
  before contacting websites.

One honest caveat: the sources are third-party websites that can go offline or change at any
time. This fork cannot promise they stay reachable, but it promises that you will know right
away when they do not.
<!-- cover:end -->

## For AI agents: install this package

If you were asked to connect `@vernikr/biblio-mcp` as an MCP server, follow these steps. Ask the
user only where a step says so.

1. **Check Node.** `node --version` must be v22 or newer. If it is not, ask the user. Do not install
   Node or any global package yourself.
2. **Find the config file.** The default is `~/.agents/mcp.json` (read by FreeBuff and ZCode), with
   the top-level key `mcpServers`. If the user's client is different, ask for its MCP config path.
   Do not guess a path, and never write MCP entries into app state files such as `state.json`.
   For Claude Code, run `claude mcp add -s user biblio -- npx --yes @vernikr/biblio-mcp@latest`
   instead of editing a file.
3. **Merge the entry safely.**
   - Back up the file first: `cp <file> <file>.bak-$(date +%s)`. If it does not exist, create it
     with `{"mcpServers": {}}`.
   - Parse it as JSON. If it does not parse, stop and tell the user. Do not repair it.
   - Set only `mcpServers.biblio` to this entry, and keep every other key:

     ```json
     {
       "command": "npx",
       "args": [
         "--yes",
         "@vernikr/biblio-mcp@latest"
       ]
     }
     ```

   - Do not add `allowedTools`, `autoApprove` or `disabled` unless the user asks. A wrong
     allow-list silently blocks the real tools.
   - Write to `<file>.tmp`, check that it is valid JSON, then rename it over `<file>`.
   - If the user's client is a GUI app that reports it cannot find `npx` or `node`, ask the user to
     run `npx --yes @vernikr/biblio-mcp@latest --print-config` and paste the entry it prints, which
     includes a `PATH`.
4. **Enable it by hand.** Ask the user to restart the client, turn the `biblio` server on in its
   MCP settings, and approve tool use if asked. You cannot click these for them.
5. **Verify through the client, not the file.** The client must list these tools for `biblio`:
   `search_books`, `book_details`, `get_download_links`, `download_book`, `fetch_book`,
   `search_papers`, `get_paper`, `healthcheck`. Call `healthcheck`. If no tools appear, report what
   the client's MCP log says. A valid JSON file alone is not success.

Rules: no `sudo`, no global installs. Never put a path containing `fnm_multishells` or `/tmp` into a
config. Put API keys only into the client's `env` block, and only if the user gives them to you.
Never print a key back.

## What is biblio-mcp?

biblio-mcp is an open-source MCP server that acts as a unified search layer across the four largest shadow libraries on the internet. Instead of installing and configuring separate MCP servers for each source, biblio-mcp combines them into a single server with a shared data model and automatic deduplication.

It connects to any MCP client (Claude, Cline, Cursor, Windsurf, or custom agents) and gives your AI assistant the ability to search for books, find academic papers by DOI, resolve download links, and download files — all through natural language.

### How it works

One query fans out to every enabled source at once; results are merged and deduplicated by MD5;
a source that fails is reported on its own and never silently swallowed. The full request flow is
in [`docs/architecture.md`](docs/architecture.md).

### Sources covered

| Source | What it provides | Searched by default? |
|---|---|---|
| **Anna's Archive** | Book search, metadata, download links (partner servers, IPFS) | Yes |
| **Library Genesis (Libgen)** | Book search, academic paper search (scimag), direct `get.php` downloads | Yes |
| **Sci-Hub** | Paper PDF resolution by DOI, URL, or title | On demand via `get_paper` or `search_papers({ resolvePdfs: true })` |
| **Z-Library** | Best-effort public book search (no login required) | **No** — see [Known limitations](#known-limitations) |

## Install

Three ways to install; the launcher is the one the Quick start uses.

### Launcher (npx) — recommended

`npx --yes @vernikr/biblio-mcp@latest` needs no checkout and no build tools, and fetches the
newest release each time the client starts. Pin an exact release by replacing `@latest` with the
version you want. Claude Code can register the same launcher:

```bash
claude mcp add -s user biblio -- npx --yes @vernikr/biblio-mcp@latest
npx --yes @vernikr/biblio-mcp@latest --print-config   # print the entry, write nothing
```

`--print-config` prints the Quick start entry with the absolute path to `npx` and a `PATH` that
lets GUI-started clients find `npx` and node. It contains no keys; add those to the client's
`env` block yourself.

To have an agent do the install: [For AI agents](#for-ai-agents-install-this-package).

### npm package or release tarball

Requires Node 22+. Install the prepared artifact, then configure your client to launch
`biblio-mcp` on stdio:

```bash
npm install --global /path/to/vernikr-biblio-mcp-<version>.tgz
biblio-mcp --selfcheck --offline
```

This installs production dependencies, not TypeScript or this checkout. Use
`"command": "biblio-mcp", "args": []`. The `biblio-mcp` npm name still belongs to upstream; this
fork publishes as **`@vernikr/biblio-mcp`**.

### MCPB (Claude Desktop extension)

The `.mcpb` holds the same compiled runtime plus locked production dependencies; its settings UI
offers an optional Anna's Archive member key and the default excluded sources. No pnpm, npm or
TypeScript — the Desktop host supplies Node, which must meet the Node 22+ requirement. The
extension is unsigned: review its source and permissions. No marketplace listing or automatic
update guarantee is implied.

## Tools

| Tool | What it does |
|---|---|
| `search_books` | Search the enabled sources at once; merged & deduped by MD5. Returns title, author, year, format, size, and md5 (when the source provides one; Z-Library does not) for each result, plus concise source-level `errors`. If you pass `sources`, select at least one; duplicates are ignored. An exact `(source, query, limit)` result—including a source error—is reused briefly within this process. |
| `book_details` | Full metadata + download options for one book by MD5 hash. Queries Anna's Archive and Libgen in parallel when mirrors are available, returns the first usable result, and reports which one answered (`resolvedVia`). Libgen's `ads.php` response is reused across details and download-link lookups. |
| `get_download_links` | Every resolvable download URL for an MD5 — Libgen `get.php`, Anna's partner servers, IPFS gateways. Links marked `direct: true` point straight at the file; unrelated scraped links are dropped, while member API URLs are trusted for the requested MD5 even when their signed URL is opaque. A recent Libgen `ads.php` response is reused. The result says why a link is missing: `notFound` lists sources that have no record, and `errors` lists sources that were unavailable. An empty list with an unavailable source is returned as an error, not as "no links". |
| `download_book` | Stream the actual file to a local directory by MD5. `output_dir` is optional and defaults to `~/Downloads/biblio-mcp`. Returns the saved path, byte count, and **the MD5 of what was written**; a mismatch sets `md5MatchesRequest: false` and includes a warning. Emits progress notifications while transferring. Failures list `sourceErrors` when a source was unavailable, and `alternatives` (other copies of the same title, ranked) when this MD5 cannot be saved. |
| `fetch_book` | Get a book by title in one call: search, rank the copies (requested format, then PDF, then the largest), try up to `max_attempts` (1–5, default 3) with the next copy when one fails, and save the first that verifies. Returns `picked`, the `attempts` made, and — when nothing could be saved — the `alternatives` its search already ranked, with a `nextStep`. Use it when you want a file, not a list. |
| `search_papers` | Search Library Genesis scimag for papers; returns title, journal, authors, DOI and year. Set `resolvePdfs: true` to best-effort add direct `pdfUrl` values for up to three DOI results (extra Sci-Hub requests). |
| `get_paper` | Resolve a paper's PDF via Sci-Hub by DOI, URL, or title. Returns the direct PDF URL when available. |
| `healthcheck` | Can this server reach its sources? Per-mirror status and latency, without querying a catalogue. Use it to tell "the network is blocked" apart from "the query matched nothing". |

### Built for AI agents, not just for people

The caller is usually a model that cannot read the source, cannot see the server's working
directory, and will keep retrying until something works. Four things exist for that reader:

- **Every tool description ends with a runnable example**, e.g.
  `Example: {"query":"dune frank herbert","limit":5}`. One MCP bridge advertised `search_books`
  as taking no parameters at all; the example in the schema is what stops an agent guessing.
- **Argument errors are sentences, not validation dumps**:
  `download_book: "md5" is missing. Schema: required: "md5" — …`, or
  `"md5" must be a 32-char MD5 hash` for a bad value.
- **`output_dir` resolves against `$HOME`, not the server's working directory**, and the response
  reports the resolved `outputDir` with a `note`.
- **`healthcheck` answers "can this server reach anything?"** in seconds, so a blocked network and
  an unmatched query stop looking identical. Blank searches are rejected before any request.

### Typical flow

**Books:**

1. `search_books({ query: "dune frank herbert" })` → results, each with an `md5`
2. `get_download_links({ md5: "..." })` → pick a `direct: true` link, **or**
3. `download_book({ md5: "..." })` → saved file in `~/Downloads/biblio-mcp` (or pass `output_dir`)

**Or in one call:** `fetch_book({ query: "dune frank herbert", format: "EPUB" })`.

`download_book` answers with `saved`, `path`, `bytes`, `via`, `md5`, `md5MatchesRequest` and
`contentType`. `md5MatchesRequest: true` is the useful bit: the file on disk hashes to the
catalogue entry you asked for. When it is `false`, the mirror served a different file — do not
trust it.

**Papers:**

1. `search_papers({ query: "CRISPR gene editing", resolvePdfs: true })` → results with DOIs and
   best-effort direct PDF URLs
2. If a result has no `pdfUrl`, call `get_paper({ identifier: "10.1089/crispr.2019.0064" })` →
   direct PDF URL when available

### A note on client timeouts (important)

A throttled mirror can take minutes to serve a book, and the MCP client's request timeout —
**60 seconds by default in the TypeScript SDK** — is not extended by work in progress unless the
client asks. Progress notifications are emitted throughout a transfer, but the client must opt in:

```ts
await client.callTool(
  { name: "download_book", arguments: { md5, output_dir } },
  undefined,
  { onprogress: (p) => console.log(p), resetTimeoutOnProgress: true }
);
```

Without `resetTimeoutOnProgress: true` a slow download is reported as a failure even though the
server finished and wrote a correct file. If you cannot change the client, raise its timeout.

## Configuration

All optional — sensible defaults ship built-in. Override via environment variables:

<!-- env-table:start (generated from src/config.ts) -->
| Variable | Purpose | Default |
|---|---|---|
| `BIBLIO_TIMEOUT_MS` | Timeout for scraping an HTML page, including reading its response body | 8000 |
| `BIBLIO_DOWNLOAD_TIMEOUT_MS` | Fail a download attempt that sends no response headers for this long | 30000 |
| `BIBLIO_DOWNLOAD_STALL_MS` | Abort a download idle for this long | 30000 |
| `BIBLIO_MIRROR_DEAD_TTL_MS` | How long a failed mirror is skipped | 300000 |
| `BIBLIO_MIRROR_STAGGER_MS` | Head start between concurrent mirror attempts; 0 starts all at once | 120 |
| `BIBLIO_ANNAS_API_KEY` | Anna's Archive member key; enables the fast-download JSON API, which is not behind the DDoS-Guard challenge | unset |
| `BIBLIO_DISABLE_SOURCES` | Sources excluded from the default search set | zlibrary |
| `BIBLIO_ANNAS_MIRRORS` | Comma-separated Anna's Archive base URLs | built-in list (src/mirrors.ts) |
| `BIBLIO_LIBGEN_MIRRORS` | Comma-separated Libgen base URLs | built-in list (src/mirrors.ts) |
| `BIBLIO_SCIHUB_MIRRORS` | Comma-separated Sci-Hub base URLs | built-in list (src/mirrors.ts) |
| `BIBLIO_ZLIB_MIRRORS` | Comma-separated Z-Library domains | built-in list (src/mirrors.ts) |
| `BIBLIO_IPFS_GATEWAYS` | IPFS gateway bases for CID fallback | built-in list (src/mirrors.ts) |
| `BIBLIO_SKIP_STARTUP_CHECK` | Set to any value to skip the startup tool-surface check and serve even if it is broken | unset |
<!-- env-table:end -->

Mirror lists are ordered by preference: earlier hosts get a head start, and hosts that were
unreachable at the last audit are kept at the end rather than deleted, so a domain that comes
back is still used. `pnpm selfcheck` prints the current reachability of every host with timings.

Two of these deserve a note:

- **`BIBLIO_TIMEOUT_MS` covers page scraping only.** Downloads got their own, much larger
  budget. Sharing one number made page scraping far too patient and file downloads far too
  strict — a book larger than a few megabytes could not finish at all.
- **`BIBLIO_MIRROR_DEAD_TTL_MS`** is what makes search fast. Without a negative cache, every
  request paid the full timeout for every dead mirror on every call.

## About this fork

This is a maintained fork of [`yashimosh/biblio-mcp`](https://github.com/yashimosh/biblio-mcp).
The original idea is unchanged: **one tool that lets an AI assistant search the world's shadow
libraries and download a book or a paper**. What this fork changes is everything around that
idea — how reliably it installs, how honestly it reports problems, and how much of your time it
wastes when something is wrong.

Upstream's published version could install cleanly, start up and look healthy in a client's tool
list, then fail on *every single request*, with an internal error that tells a human nothing.

Why one server instead of four, and what this fork changed, are in
[`docs/about-this-fork.md`](docs/about-this-fork.md).

## Known limitations

Stated plainly, because a tool that hides its failures costs more time than one that admits them.

- **`book_details` races Anna's Archive and Libgen in parallel.** Anna's scraped HTML often
  answers **HTTP 403** to non-browser clients (DDoS-Guard); Libgen's `ads.php` page embeds a
  **BibTeX block** with exact title/author/publisher/ISBN/year/series. The first usable result
  wins and the response reports `resolvedVia`. After three consecutive real failures — not
  counting a record that simply does not exist — that provider is paused for a cooldown window.
  Members can still use `BIBLIO_ANNAS_API_KEY` for the independent fast-download JSON endpoint;
  the key is sent only to a mirror that proves it is Anna's Archive.
- **Abandoned domains get re-registered, and this one bit us.** `annas-archive.li` was taken down
  under publisher pressure and now answers HTTP 200 faster than every genuine mirror — while
  serving a page of advertising JavaScript. A liveness check that trusts status codes ranked it
  *first*, and the parsers could quietly turn an ad page into "zero results, no error". Every
  source group now carries a positive identity marker, used by `healthcheck` and `selfcheck`, and
  Anna's scraped pages pass a content validator. Sci-Hub can answer HTTP 200 with a human-check
  (ALTCHA) page; that counts as a failed mirror, and the caller is told when every mirror asks
  for a check. If you add mirrors, keep the matching identity marker accurate.
- **Provider results are cached briefly, in process.** Exact `(source, query, limit)` searches
  (including source-level failures) and Libgen `ads.php` pages keyed by MD5 are reused for a
  short TTL, which avoids repeat mirror latency across an agent's search→details→links cycle. A
  newly recovered mirror may not be retried for that exact query until it expires. Restarting the
  server clears these caches.
- **Libgen columns are read by header name, not by position.** A parser that assumed positions
  reported the series name and a list of ISBNs as the author. Columns are resolved from the
  table's `<th>` row, with a positional fallback for mirrors that ship no header, and `series` is
  its own field. File sizes go through a bounded parser, so a digit run from the pages column can
  no longer be reported as a size.
- **Explicit download filenames are never overwritten**, even if a file appears mid-transfer. This
  needs hard-link support in the output filesystem; without it the tool fails safely rather than
  risk an overwrite. Without `filename`, existing MD5-based files may still be replaced.
- **Download links are filtered before they reach you.** A link is only reported if it has a path
  beyond the domain root and references the requested MD5 — Libgen's `ads.php` page links the
  bare `http://annas-archive.org/` homepage, which used to appear as a download option. Two
  exceptions: IPFS gateway links carry a CID instead, and member-API links are trusted for the
  requested MD5 even when their signed URL is opaque.
- **Z-Library is off by default.** Every public domain in the built-in list was unreachable at the
  last mirror audit, so querying it by default only added latency and an error you could not act
  on. Pass `sources: ["zlibrary"]` explicitly, or remove it from `BIBLIO_DISABLE_SOURCES`.
  `BIBLIO_ZLIB_MIRRORS` only sets which domains are tried. Anna's Archive indexes the Z-Library
  collection anyway.
- **Sci-Hub mirrors sometimes gate behind a captcha**, but the PDF embed URL is still present in
  the HTML for most mirrors, so `get_paper` usually extracts it. When it cannot, the error says
  whether the paper is absent or the mirrors were unavailable.
- **These sites change their HTML often.** Parsers live in
  [`src/providers/`](src/providers/) and mirrors in
  [`src/mirrors.ts`](src/mirrors.ts) — both are small and easy to patch.

### Roadmap

What is released, verified and next is in [`docs/STATE.md`](docs/STATE.md). The closed audit is
in [`docs/worklog/archive/2026.10.08-audit/`](docs/worklog/archive/2026.10.08-audit/).

## FAQ

### How do I search for books with Claude?

`claude mcp add -s user biblio -- npx --yes @vernikr/biblio-mcp@latest`, then ask naturally:
"Find me Dune by Frank Herbert as an EPUB."

### Does this work with ChatGPT or other AI assistants?

Any client that speaks MCP over stdio. If it cannot launch subprocesses, wrap the server with a
stdio-to-HTTP bridge such as `mcp-remote`.

### Do I need an account on any of these sites?

No. Z-Library's full catalogue does require a login, which is why its public search is
best-effort and off by default.

### The server starts but every tool call fails. What now?

From a checkout run `pnpm preflight`; for an installed artifact run `biblio-mcp --selfcheck
--offline`. If it reports `zod-sdk-compat: FAIL`, the message names the exact command that fixes
it. This fork pins compatible versions and CI checks the pairing on every push.

## Development

Maintainers: [`AGENTS.md`](AGENTS.md) — setup, every script, and the contributing rules.
Current state: [`docs/STATE.md`](docs/STATE.md). Layout and the invariants:
[`docs/architecture.md`](docs/architecture.md).

## Legal

This tool is a client that queries publicly reachable third-party websites; it
hosts no content itself. Copyright law varies by country. You are responsible
for ensuring your use complies with the laws of your jurisdiction and with the
rights of copyright holders. Provided for research, archival, and accessibility
purposes. The authors do not endorse copyright infringement.

## License

[MIT](LICENSE)
