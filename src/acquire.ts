// Turning a catalogue MD5 into a file on disk. Shared by download_book and fetch_book,
// so both obey the same rules: direct links only, HTML never saved, MD5 reported,
// caller-chosen names never overwritten.

import { access, link as linkFile, mkdir, open, rename, unlink } from "node:fs/promises";
import { join, isAbsolute, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { downloadToFile, HtmlInsteadOfFileError, type DownloadProgress } from "./http.js";
import { sniffExt } from "./sniff.js";
import {
  bookDetails,
  BOOK_SOURCES,
  resolveDownloadReport,
  searchBooks,
  type BookDetailsResult,
  type DownloadResolution,
} from "./providers/index.js";
import type { Book, SourceId } from "./types.js";

/** Where files go when the caller names no directory: a folder the user can find. */
export function defaultOutputDir(): string {
  return join(homedir(), "Downloads", "biblio-mcp");
}

export interface SaveRequest {
  /** Absolute, or relative to $HOME. Created if missing. */
  outputDir: string;
  /** A caller-chosen plain file name; when set, an existing file is never replaced. */
  plainName?: string;
  /** Other copies to suggest if this one cannot be saved. A caller that already
   *  ranked a candidate list passes it here; otherwise the copies are looked up
   *  by title. An empty array means "there are none", not "go and find them". */
  alternatives?: Alternative[];
  onProgress: (p: DownloadProgress) => Promise<void>;
  signal?: AbortSignal;
}

export interface SaveOutcome {
  saved: boolean;
  /** JSON body for the tool result; `saved` mirrors the outcome. */
  body: Record<string, unknown>;
}

/** Read the first `bytes` of a file. Used to sniff a container format after a
 *  streamed download, when we never held the whole file in memory. */
async function readFileHead(path: string, bytes: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Providers a save depends on; tests replace them, production uses the real ones. */
export interface SaveDeps {
  resolve: (hash: string) => Promise<DownloadResolution>;
  alternatives: (hash: string) => Promise<Alternative[]>;
}

const DEFAULT_SAVE_DEPS: SaveDeps = {
  resolve: resolveDownloadReport,
  alternatives: (hash) => findAlternatives(hash),
};

/** Resolve the candidate links for `hash` and save the first one that yields a real file. */
export async function saveBook(
  hash: string,
  req: SaveRequest,
  deps: SaveDeps = DEFAULT_SAVE_DEPS
): Promise<SaveOutcome> {
  const { links, errors: sourceErrors } = await deps.resolve(hash);
  const alternativesFor = () => req.alternatives ?? deps.alternatives(hash);
  const direct = links.filter((l) => l.direct);
  if (direct.length === 0) {
    const alternatives = await alternativesFor();
    return {
      saved: false,
      body: {
        saved: false,
        reason:
          sourceErrors.length > 0
            ? "No direct download link resolved, and at least one source was unavailable. " +
              "Retry later, or use these links manually."
            : "No direct download link resolved. Use these links manually.",
        links,
        ...(sourceErrors.length ? { sourceErrors } : {}),
        ...withAlternatives(alternatives),
      },
    };
  }

  // Resolve relative output paths from $HOME, a predictable location for both sides.
  const wasRelative = !isAbsolute(req.outputDir);
  const dir = wasRelative ? resolve(homedir(), req.outputDir) : req.outputDir;
  await mkdir(dir, { recursive: true });

  // A file the caller named is theirs: refuse rather than overwrite it.
  const plainName = req.plainName;
  if (plainName !== undefined) {
    const taken = await access(join(dir, plainName)).then(() => true, () => false);
    if (taken) {
      return {
        saved: false,
        body: { saved: false, reason: `${plainName} already exists in ${dir}; choose another filename.` },
      };
    }
  }

  // A staging name unique to this call, so concurrent downloads of the same
  // md5 into the same directory cannot write or delete each other's bytes.
  const staging = join(dir, `${hash}.${randomUUID()}.downloading`);
  const errors: string[] = [];

  for (const link of direct) {
    try {
      const result = await downloadToFile(link.url, staging, {
        onProgress: req.onProgress,
        signal: req.signal,
      });

      const name = plainName ?? `${hash}.${sniffExt(await readFileHead(staging, 4096), result.contentType)}`;
      const path = join(dir, name);
      try {
        // A precheck cannot prevent a concurrent writer. link is atomic and
        // refuses an existing caller-chosen name; never fall back to rename.
        if (plainName !== undefined) await linkFile(staging, path);
        else await rename(staging, path);
      } catch (e) {
        await unlink(staging).catch(() => {});
        // Publication is a local failure, not a reason to try another URL.
        return {
          saved: false,
          body: {
            saved: false,
            reason: (e as NodeJS.ErrnoException).code === "EEXIST"
              ? `${name} already exists in ${dir}; choose another filename.`
              : `Cannot publish ${name} in ${dir}: ${(e as Error).message}`,
          },
        };
      }
      if (plainName !== undefined) await unlink(staging).catch(() => {});

      return {
        saved: true,
        body: {
          saved: true,
          path,
          /** Absolute directory the file landed in — always resolved, so a
           *  relative `output_dir` never leaves the caller guessing. */
          outputDir: dir,
          ...(wasRelative
            ? { note: `"${req.outputDir}" was relative; resolved to ${dir}. Pass an absolute path to avoid surprises.` }
            : {}),
          bytes: result.bytes,
          via: link.label,
          ...(sourceErrors.length ? { sourceErrors } : {}),
          /** Hex MD5 of the bytes on disk. */
          md5: result.md5,
          /** True when the file's own hash equals the catalog hash requested. */
          md5MatchesRequest: result.md5 === hash,
          ...(result.md5 !== hash
            ? {
                warning:
                  "Downloaded file MD5 does not match the requested catalog MD5; " +
                  "verify it before use.",
              }
            : {}),
          contentType: result.contentType,
        },
      };
    } catch (e) {
      await unlink(staging).catch(() => {});
      if (e instanceof HtmlInsteadOfFileError) {
        // The one-time key in a Libgen get.php URL expires, and the page it
        // then serves is HTML. Move on to the next candidate; never save it.
        errors.push(`${link.label}: served an HTML page, not a file`);
        continue;
      }
      errors.push(`${link.label}: ${(e as Error).message}`);
    }
  }
  const alternatives = await alternativesFor();
  return {
    saved: false,
    body: {
      saved: false,
      errors,
      links,
      ...(sourceErrors.length ? { sourceErrors } : {}),
      ...withAlternatives(alternatives),
    },
  };
}

// ---------------------------------------------------------------------------
// Other copies of the same book
// ---------------------------------------------------------------------------

export interface Alternative {
  md5: string;
  title: string;
  author?: string;
  format?: string;
  size?: string;
  source: SourceId;
}

const MAX_ALTERNATIVES = 5;
const MD5 = /^[a-f0-9]{32}$/;

/** "9.2 MB" -> bytes. Unknown or unparseable sizes sort last. */
function sizeInBytes(size: string | undefined): number {
  const m = /^([\d.]+)\s*(B|kB|KB|MB|GB)$/i.exec((size ?? "").trim());
  if (!m) return -1;
  const unit = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[(m[2] ?? "").toLowerCase()] ?? 1;
  return Number(m[1]) * unit;
}

function formatRank(format: string | undefined, wanted: string | undefined): number {
  const f = (format ?? "").toLowerCase();
  if (wanted && f === wanted.toLowerCase()) return 0;
  if (f === "pdf") return 1;
  if (f === "epub") return 2;
  return 3;
}

/** Usable copies only (a real MD5), one per hash, best first: the requested
 *  format, then PDF, then EPUB, then the largest known size. */
export function rankCandidates(
  books: Book[],
  opts: { format?: string; exclude?: string } = {}
): Book[] {
  const seen = new Set<string>();
  const usable: Book[] = [];
  for (const book of books) {
    const md5 = book.md5?.toLowerCase();
    if (!md5 || !MD5.test(md5) || seen.has(md5) || md5 === opts.exclude?.toLowerCase()) continue;
    seen.add(md5);
    usable.push({ ...book, md5 });
  }
  return usable.sort(
    (a, b) =>
      formatRank(a.format, opts.format) - formatRank(b.format, opts.format) ||
      sizeInBytes(b.size) - sizeInBytes(a.size)
  );
}

export interface AlternativeDeps {
  details: (hash: string) => Promise<Pick<BookDetailsResult, "title" | "author">>;
  search: (query: string, sources: SourceId[], limit: number) => Promise<{ results: Book[]; errors: unknown[] }>;
}

const DEFAULT_ALTERNATIVE_DEPS: AlternativeDeps = {
  details: (hash) => bookDetails(hash),
  search: (query, sources, limit) => searchBooks(query, sources, limit),
};

/** Usable copies as the shape a failure response suggests them in. */
function toAlternatives(books: Book[]): Alternative[] {
  return books.slice(0, MAX_ALTERNATIVES).map((b) => ({
    md5: b.md5 as string,
    title: b.title,
    ...(b.author ? { author: b.author } : {}),
    ...(b.format ? { format: b.format } : {}),
    ...(b.size ? { size: b.size } : {}),
    source: b.source,
  }));
}

/** Other copies of the book behind `hash`, found by its title. Best-effort: any
 *  failure yields an empty list, because this only ever adds a suggestion. */
export async function findAlternatives(
  hash: string,
  deps: AlternativeDeps = DEFAULT_ALTERNATIVE_DEPS
): Promise<Alternative[]> {
  try {
    const details = await deps.details(hash);
    if (!details.title) return [];
    const query = [details.title, details.author].filter(Boolean).join(" ");
    const { results } = await deps.search(query, BOOK_SOURCES, 20);
    return toAlternatives(rankCandidates(results, { exclude: hash }));
  } catch {
    return [];
  }
}

/** Failure fields an agent can act on: the copies to try next and what to do. */
function withAlternatives(alternatives: Alternative[]): Record<string, unknown> {
  const [first] = alternatives;
  if (!first) {
    return {
      alternatives,
      nextStep:
        "No other copy of this title was found. Try a different query (add the author or edition), or retry later.",
    };
  }
  return {
    alternatives,
    nextStep:
      `Other copies of this title exist. Call download_book again with one of their md5 values ` +
      `(for example ${first.md5}), or use fetch_book to try them in order.`,
  };
}

// ---------------------------------------------------------------------------
// fetch_book: one call from a title to a verified file
// ---------------------------------------------------------------------------

export interface FetchBookArgs {
  query: string;
  outputDir: string;
  format?: string;
  sources?: SourceId[];
  maxAttempts?: number;
  onProgress: (p: DownloadProgress) => Promise<void>;
  signal?: AbortSignal;
}

export interface FetchBookDeps {
  search: (query: string, sources: SourceId[], limit: number) => Promise<{ results: Book[]; errors: unknown[] }>;
  saveBook: (hash: string, req: SaveRequest) => Promise<SaveOutcome>;
}

const DEFAULT_FETCH_DEPS: FetchBookDeps = {
  search: (query, sources, limit) => searchBooks(query, sources, limit),
  saveBook: (hash, req) => saveBook(hash, req),
};

/** Search, rank, then try copies in order until one saves and verifies. */
export async function fetchBook(
  args: FetchBookArgs,
  deps: FetchBookDeps = DEFAULT_FETCH_DEPS
): Promise<Record<string, unknown>> {
  const maxAttempts = Math.max(1, Math.min(args.maxAttempts ?? 3, 5));
  const sources = args.sources ?? BOOK_SOURCES;
  const { results, errors } = await deps.search(args.query, sources, 20);
  const candidates = rankCandidates(results, { format: args.format });
  const searchErrors = errors.length ? { searchErrors: errors } : {};

  if (candidates.length === 0) {
    return {
      saved: false,
      query: args.query,
      reason: results.length === 0
        ? "No results for this query."
        : "Results were found, but none has a catalogue MD5 to download by.",
      attempts: [],
      nextStep: "Try a different query (add the author or edition), or retry later if a source was down.",
      ...searchErrors,
    };
  }

  const attempts: Record<string, unknown>[] = [];
  const tried = new Set<string>();
  // The ranked list is already the answer to "what else could I try?". Looking
  // the copies up by title instead costs a details call plus a full search for
  // every copy that fails to save, and returns copies ranked here already.
  const untried = () => candidates.filter((c) => !tried.has(c.md5 as string));
  for (const candidate of candidates.slice(0, maxAttempts)) {
    const md5 = candidate.md5 as string;
    tried.add(md5);
    const outcome = await deps.saveBook(md5, {
      outputDir: args.outputDir,
      onProgress: args.onProgress,
      signal: args.signal,
      alternatives: toAlternatives(untried()),
    });
    const info = {
      md5,
      title: candidate.title,
      ...(candidate.author ? { author: candidate.author } : {}),
      format: candidate.format,
      size: candidate.size,
      source: candidate.source,
    };
    if (outcome.saved) {
      return {
        ...outcome.body,
        query: args.query,
        picked: info,
        attempts: [...attempts, { ...info, saved: true }],
        ...searchErrors,
      };
    }
    const body = outcome.body;
    const error =
      typeof body.reason === "string"
        ? body.reason
        : Array.isArray(body.errors) && body.errors.length
          ? body.errors.join("; ")
          : "download failed";
    attempts.push({ ...info, saved: false, error });
  }

  const remaining = toAlternatives(untried());
  const [next] = remaining;
  return {
    saved: false,
    query: args.query,
    reason: `None of the first ${attempts.length} copies could be saved.`,
    attempts,
    // What the agent can still do: the search found these, fetch_book never
    // reached them, and nothing has been said about whether they work.
    ...(next
      ? {
          alternatives: remaining,
          nextStep:
            `The search found ${remaining.length} further ${remaining.length === 1 ? "copy" : "copies"} ` +
            `that fetch_book did not reach. Call download_book with one of their md5 values ` +
            `(for example ${next.md5}), or raise max_attempts.`,
        }
      : {
          nextStep:
            "Retry later (a source may be briefly down), try another format or a more specific query, " +
            "or use the links from get_download_links.",
        }),
    ...searchErrors,
  };
}
