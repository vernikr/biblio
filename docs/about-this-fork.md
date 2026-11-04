# About this fork

Why this fork exists, what it found broken upstream, and what it changed. This is
background for people choosing between the two packages; it is not needed to install
or use the server.

## Why one server instead of separate ones

| | biblio-mcp | Separate MCP servers |
|---|---|---|
| **Setup** | One clone, one install, one self-check | Install 4 servers in 3 languages (Go, Python, Node) |
| **Config** | One entry in MCP settings | Four entries, four sets of env vars |
| **Dedup** | Automatic — same book from 3 sources = 1 result | Manual — you see duplicates |
| **Mirrors** | Built-in rotation with a negative cache, one file to update | Each server manages its own |
| **Fault tolerance** | Source down? Others still work | Server down? That source is gone |
| **Papers + Books** | Both in one server | Need separate servers for Sci-Hub vs Libgen |

## About this fork

This is a maintained fork of [`yashimosh/biblio-mcp`](https://github.com/yashimosh/biblio-mcp).
The original idea is unchanged and still good: **one tool that lets an AI assistant search
the world's shadow libraries and download a book or a paper**. What this fork changes is
everything that happens *around* that idea — how reliably it installs, how honestly it
reports problems, and how much of your time it wastes when something is wrong.

**The problem we found.** The published version could install cleanly, start up, and appear
perfectly healthy in your AI client's list of tools — and then fail on *every single request*.
Nothing in the setup warned you, and the error message it produced was an internal one
(`keyValidator._parse is not a function`) that tells a human nothing. In practice this sent
both people and AI agents off on long detours: reading source code, guessing at arguments,
rewriting working software by hand. One such attempt burned a long detour and still did not
download the book.

**What this fork does about it.**

| | Before (upstream) | In this fork |
|---|---|---|
| **Broken installs** | Look healthy, then fail on every request | Detected before the first request, with the exact command that fixes it |
| **A broken build that starts anyway** | Listed its tools cheerfully, then failed every one of them | Refuses to start, and says which two packages to fix |
| **Installing it** | Six commands, and the npm package is the broken one | `node scripts/install.mjs` — and it checks itself before handing you a config |
| **Proving it works** | No way short of using it and hoping | `pnpm selfcheck` reports tools, mirror health and timings |
| **Search speed** | Slowed by waiting on dead websites, on every search | A failed host is skipped for a cooldown window instead |
| **Downloads** | Saved whatever came back, including stray web pages | Streamed to disk and checksum-verified, so you know it is the right file |
| **A dead source** | Slowed down every search and reported an error you could not act on | Switched off by default; opt back in when you have a working address |
| **A domain that stopped being the real site** | Answered “OK”, got trusted, and quietly returned nothing | Detected and refused — a status code is not proof of identity |
| **Wrong book data** | Reported the series name and a list of ISBNs as the author | Read from the column the page actually labels, so `author` is the author |
| **Useless download links** | Offered a bare homepage as a way to download the book | Filtered out — a link is only offered if it can reach that file |
| **Long downloads** | Could silently outlast your client's timeout | Reports progress while transferring |
| **A wrong tool call** | Answered with a validation dump only a programmer could read | Answers with the argument that is missing and a working example |
| **“Is anything even reachable?”** | No way to ask; a blocked network looked like an empty search | `healthcheck` says which sources answer, and how fast |

**The honest caveats.** Catalogue data now comes from the column a page actually labels, and
`book_details` reads structured metadata (a BibTeX block) instead of guessing at a web page —
but these are third-party sites with no stability guarantees. They change their layout, they
go offline, and domains get re-registered by other people. No fork can promise they stay
reachable. What this fork promises is narrower and more useful: **when something is broken, it
tells you immediately and tells you what to do.**

**Not sure which to use?** If you just want the tools to work and to be told the truth when
they do not, use this fork. If you specifically need the upstream npm package, note that its
published dependency set is the combination described above.
