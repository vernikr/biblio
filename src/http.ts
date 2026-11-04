// Resilient HTTP layer with mirror rotation.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NUMBER_SETTINGS, readNumber } from "./config.js";
import { errText } from "./errors.js";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/** Budget for scraping an HTML page (search results, ads.php, md5 detail). */
const TIMEOUT_MS = readNumber(NUMBER_SETTINGS.timeoutMs);

/** How long a file server may take to answer with headers. Once bytes flow the
 *  transfer is guarded by the idle watchdog (DOWNLOAD_STALL_MS), not by this
 *  budget, so a long steady download is not cut off by it. */
const DOWNLOAD_TIMEOUT_MS = readNumber(NUMBER_SETTINGS.downloadTimeoutMs);

/** How long a failed mirror is skipped before being given another chance. */
const DEAD_TTL_MS = readNumber(NUMBER_SETTINGS.mirrorDeadTtlMs);

/** Head start between concurrent mirror attempts. 0 disables staggering and
 *  makes the race fully simultaneous (fastest, least polite to the mirrors). */
const STAGGER_MS = readNumber(NUMBER_SETTINGS.mirrorStaggerMs);

/** Abort a download if no bytes arrive for this long. Guards against a mirror
 *  that accepts the connection and then stalls forever. */
const DOWNLOAD_STALL_MS = readNumber(NUMBER_SETTINGS.downloadStallMs);

/** Refuse to hold more of a scraped page in memory than this. A catalogue page is
 *  a few hundred kilobytes; a host that sends more is misbehaving, and up to one
 *  body per mirror would otherwise land in memory at once. */
const MAX_PAGE_BYTES = 20 * 1024 * 1024;

/** Remembers, per mirror-group, which host last succeeded. */
const preferredMirror = new Map<string, string>();

/** Remembers, per mirror-group + host, when a failure stops being held against
 *  it. Keyed as `${group}\u0000${base}`. */
const deadUntil = new Map<string, number>();

const deadKey = (group: string, base: string) => `${group}\u0000${base}`;

function noteDead(groupKey: string, base: string): void {
  deadUntil.set(deadKey(groupKey, base), Date.now() + DEAD_TTL_MS);
}

function noteAlive(groupKey: string, base: string): void {
  deadUntil.delete(deadKey(groupKey, base));
  preferredMirror.set(groupKey, base);
}

function isDead(groupKey: string, base: string): boolean {
  const until = deadUntil.get(deadKey(groupKey, base));
  if (until === undefined) return false;
  if (until <= Date.now()) {
    deadUntil.delete(deadKey(groupKey, base));
    return false;
  }
  return true;
}

/** Clear cooldowns without forgetting the last-known-good mirror. Healthcheck
 *  needs fresh measurements, but should not discard useful request stickiness. */
export function resetDeadCache(): void {
  deadUntil.clear();
}

/** Reset all mirror state. Used by --selfcheck and tests that require a clean
 *  race, including preferred-mirror state. */
export function resetMirrorCache(): void {
  resetDeadCache();
  preferredMirror.clear();
}

/** True when every configured mirror is still in its negative-cache window. */
export function areMirrorsCoolingDown(groupKey: string, mirrors: string[]): boolean {
  return mirrors.length === 0 || mirrors.every((base) => isDead(groupKey, base));
}

/** Test-only / diagnostic view of the negative cache. */
export function mirrorCacheSnapshot(): { dead: string[]; preferred: Record<string, string> } {
  const now = Date.now();
  const dead: string[] = [];
  for (const [k, until] of deadUntil) {
    const base = k.split("\u0000")[1];
    if (until > now && base) dead.push(base);
  }
  return { dead: [...new Set(dead)], preferred: Object.fromEntries(preferredMirror) };
}

/** Build the attempt order for a request. */
function orderMirrors(groupKey: string, mirrors: string[]): string[] {
  const preferred = preferredMirror.get(groupKey);
  const ordered =
    preferred && mirrors.includes(preferred)
      ? [preferred, ...mirrors.filter((m) => m !== preferred)]
      : [...mirrors];

  const alive = ordered.filter((m) => !isDead(groupKey, m));
  return alive.length > 0 ? alive : ordered;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** One signal for our timers and the caller: either side can abort the request. */
function linkAbortSignals(...signals: Array<AbortSignal | null | undefined>): AbortSignal {
  return AbortSignal.any(signals.filter((signal): signal is AbortSignal => signal != null));
}

export async function fetchWithTimeout<T>(
  url: string,
  init: RequestInit,
  consume: (response: Response) => Promise<T>,
  externalSignal?: AbortSignal,
  timeoutMs = TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = linkAbortSignals(controller.signal, externalSignal, init.signal);

  try {
    const response = await fetch(url, {
      ...init,
      redirect: "follow",
      signal,
      headers: { ...DEFAULT_HEADERS, ...(init.headers as object) },
    });
    return await consume(response);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a scraped page, refusing to hold more than the budget of it.
 *
 * The declared length is checked first so an oversized answer is dropped before
 * a byte of it is read; the running count covers a host that streams without
 * declaring anything.
 */
async function readPageBody(res: Response, base: string): Promise<string> {
  const oversize = `${base} -> page is larger than the ${MAX_PAGE_BYTES / 1048576} MB budget`;
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_PAGE_BYTES) {
    await res.body?.cancel().catch(() => {});
    throw new Error(oversize);
  }
  if (!res.body) return "";

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_PAGE_BYTES) throw new Error(oversize);
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    // Releases the connection both after the last chunk and after giving up.
    await reader.cancel().catch(() => {});
  }
  return text + decoder.decode();
}

export interface MirrorFetchResult<T = never> {
  html: string;
  /** The base mirror that served the request (e.g. "https://libgen.li"). */
  base: string;
  finalUrl: string;
  /** Mirrors that were skipped or failed, with reasons. Surfaces in tool
   *  output so a degraded source is visible instead of silently absent. */
  attempts: string[];
  /** What a validator returned alongside its verdict, when it returned one. */
  parsed?: T;
}

/**
 * Decide whether a 2xx response really came from the site we asked for.
 *
 * A validator that has to parse the page anyway can hand the parse back as
 * `{ value }` instead of `true`; the caller then reads it from the result
 * rather than parsing the same page a second time.
 */
export type MirrorValidator<T = never> = (html: string, base: string) => boolean | string | { value: T };
type MirrorPathBuilder = (base: string) => string | string[];

class MirrorHttpError extends Error {
  constructor(base: string, readonly status: number) {
    super(`${base} -> HTTP ${status}`);
    this.name = "MirrorHttpError";
  }
}

/** A validator throws this when a 2xx answer is the right site but lacks the record
 *  (e.g. a Sci-Hub page with no PDF). The race moves on to the other mirrors. */
export class MirrorRecordMissError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MirrorRecordMissError";
  }
}

/** The mirror answered, but this record is not on it. Not a sign of a dead host. */
function isRecordMiss(error: unknown): boolean {
  if (error instanceof MirrorRecordMissError) return true;
  return error instanceof MirrorHttpError && (error.status === 404 || error.status === 410);
}

/** Every mirror answered, and none has the requested record. A healthy source
 *  says this; callers must not count it as a failure of the source. */
export class ResourceNotFoundError extends Error {
  constructor(readonly groupKey: string, readonly tried: number, message?: string) {
    super(message ?? `not found — no ${groupKey} mirror (${tried} tried) has this record`);
    this.name = "ResourceNotFoundError";
  }
}

/** Fetch an HTML page, racing the group's mirrors until one returns 2xx. */
export async function fetchFromMirrors<T = never>(
  groupKey: string,
  mirrors: string[],
  buildPath: MirrorPathBuilder,
  init?: RequestInit,
  validate?: MirrorValidator<T>
): Promise<MirrorFetchResult<T>> {
  const ordered = orderMirrors(groupKey, mirrors);
  if (ordered.length === 0) {
    const envName = groupKey === "zlibrary" ? "BIBLIO_ZLIB_MIRRORS" : `BIBLIO_${groupKey.toUpperCase()}_MIRRORS`;
    throw new Error(
      `No ${groupKey} mirrors configured; set ${envName} to one or more base URLs.`
    );
  }

  const attempts: string[] = [];
  const recordMisses: boolean[] = [];
  const controllers = new Set<AbortController>();
  const pending = ordered.map(async (base, index) => {
    const controller = new AbortController();
    controllers.add(controller);
    const signal = linkAbortSignals(controller.signal, init?.signal);

    try {
      await sleep(index * STAGGER_MS, signal);
      const urls = [buildPath(base)].flat();
      if (urls.length === 0) throw new Error(`${base} -> no request path configured`);

      let lastError: unknown;
      for (let pathIndex = 0; pathIndex < urls.length; pathIndex++) {
        const url = urls[pathIndex]!;
        try {
          const result = await fetchWithTimeout(
            url,
            init ?? {},
            async (res) => {
              if (!res.ok) {
                await res.body?.cancel().catch(() => {});
                throw new MirrorHttpError(base, res.status);
              }
              const html = await readPageBody(res, base);
              const verdict = validate?.(html, base);
              if (verdict !== undefined && verdict !== true) {
                if (typeof verdict === "object") {
                  return { html, base, finalUrl: res.url || url, attempts: [], parsed: verdict.value };
                }
                const why =
                  typeof verdict === "string" ? verdict : "response is not the expected site";
                throw new Error(`${base} -> ${why}`);
              }
              return { html, base, finalUrl: res.url || url, attempts: [] };
            },
            signal
          );
          return { base, controller, result };
        } catch (error) {
          lastError = error;
          const hasRouteFallback = pathIndex < urls.length - 1;
          if (
            signal.aborted ||
            !hasRouteFallback ||
            !(error instanceof MirrorHttpError) ||
            (error.status !== 404 && error.status !== 405)
          ) {
            throw error;
          }
        }
      }
      throw lastError ?? new Error(`${base} -> no request path succeeded`);
    } catch (error) {
      if (!signal.aborted) {
        const miss = isRecordMiss(error);
        // One missing md5 must not cool the whole host down for five minutes.
        if (!miss) noteDead(groupKey, base);
        attempts.push(errText(error));
        recordMisses.push(miss);
      }
      throw error;
    }
  });

  try {
    const winner = await Promise.any(pending);
    noteAlive(groupKey, winner.base);
    for (const controller of controllers) {
      if (controller !== winner.controller && !controller.signal.aborted) controller.abort();
    }
    return { ...winner.result, attempts };
  } catch {
    const everyMirrorMissed =
      recordMisses.length === ordered.length && recordMisses.every(Boolean);
    if (everyMirrorMissed) throw new ResourceNotFoundError(groupKey, ordered.length);
    throw new Error(
      `All ${mirrors.length} ${groupKey} mirror(s) failed: ` +
        `${(attempts.length ? attempts : ["cancelled"]).join("; ")}`
    );
  }
}

/** Thrown when a "direct" download URL serves an HTML page instead of a file. */
export class HtmlInsteadOfFileError extends Error {
  readonly contentType: string | null;

  constructor(opts: { url: string; contentType: string | null }) {
    super(
      `${opts.url} returned an HTML page (content-type ${opts.contentType ?? "unknown"}), not a file`
    );
    this.name = "HtmlInsteadOfFileError";
    this.contentType = opts.contentType;
  }
}

export interface DownloadProgress {
  bytes: number;
  /** Total size when the server advertised one, else undefined. */
  total?: number;
}

export interface DownloadToFileResult {
  /** Final path on disk. */
  path: string;
  bytes: number;
  contentType: string | null;
  /** Hex MD5 of the bytes actually written — compare against the catalog md5. */
  md5: string;
}

/**
 * Stream a URL straight to disk and hash it on the way through.
 *
 * `destPath` is owned by the caller and must be a name no other call will use:
 * bytes go to `${destPath}.part` and are renamed into place, so two calls with
 * the same `destPath` would share one staging file. `acquire.saveBook` passes a
 * UUID staging name for exactly that reason.
 */
export async function downloadToFile(
  url: string,
  destPath: string,
  opts: {
    signal?: AbortSignal;
    onProgress?: (p: DownloadProgress) => void;
    /** Overrides DOWNLOAD_TIMEOUT_MS for the response headers. */
    headersTimeoutMs?: number;
  } = {}
): Promise<DownloadToFileResult> {
  const controller = new AbortController();
  const headersBudgetMs = opts.headersTimeoutMs ?? DOWNLOAD_TIMEOUT_MS;
  let headersExpired = false;
  const requestTimer = setTimeout(() => {
    headersExpired = true;
    controller.abort();
  }, headersBudgetMs);
  // One signal for the whole transfer: our timers or the caller can abort it.
  const signal = linkAbortSignals(controller.signal, opts.signal);

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal,
      headers: DEFAULT_HEADERS,
    });
  } catch (error) {
    // The caller has to know which silence killed the attempt: that decides
    // whether to retry the link or move to another copy.
    if (headersExpired) {
      throw new Error(
        `no response headers within ${headersBudgetMs} ms (BIBLIO_DOWNLOAD_TIMEOUT_MS) for ${url}`
      );
    }
    throw error;
  } finally {
    clearTimeout(requestTimer);
  }

  const contentType = res.headers.get("content-type");

  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  // An HTML answer here means the link was an interstitial, not a file.
  // Its body is never saved, so do not read it: release the connection now.
  if (contentType?.includes("text/html")) {
    await res.body?.cancel().catch(() => {});
    throw new HtmlInsteadOfFileError({ url, contentType });
  }

  if (!res.body) throw new Error(`Empty response body from ${url}`);

  const totalHeader = Number(res.headers.get("content-length"));
  const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : undefined;

  const hash = createHash("md5");
  let bytes = 0;
  // Stall watchdog: the request timer above only covers the headers, so a
  // mirror that dribbles nothing after connecting needs its own deadline.
  let stallTimer = setTimeout(() => controller.abort(), DOWNLOAD_STALL_MS);
  const touch = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => controller.abort(), DOWNLOAD_STALL_MS);
  };

  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      hash.update(chunk);
      touch();
      opts.onProgress?.({ bytes, total });
      cb(null, chunk);
    },
  });

  const partPath = `${destPath}.part`;
  try {
    await pipeline(
      Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
      counter,
      createWriteStream(partPath)
    );
    await rename(partPath, destPath);
  } catch (err) {
    await unlink(partPath).catch(() => {});
    throw controller.signal.aborted && !(opts.signal?.aborted ?? false)
      ? new Error(
          `transfer stalled for ${DOWNLOAD_STALL_MS} ms after ${bytes} bytes (BIBLIO_DOWNLOAD_STALL_MS) for ${url}`
        )
      : err;
  } finally {
    clearTimeout(stallTimer);
  }

  return { path: destPath, bytes, contentType, md5: hash.digest("hex") };
}

export interface MirrorProbe {
  base: string;
  /** True only when the host answered 2xx AND passed the identity check. */
  ok: boolean;
  status?: number;
  ms: number;
  error?: string;
  /** Set when the host answered but did not look like the expected site. */
  impostor?: boolean;
}

/** Probe a single mirror base for liveness AND identity. Used by --selfcheck. */
export async function probeMirror(
  base: string,
  probePath = "/",
  opts: { timeoutMs?: number; expect?: RegExp } = {}
): Promise<MirrorProbe> {
  const started = Date.now();
  try {
    return await fetchWithTimeout(
      `${base}${probePath}`,
      { method: "GET" },
      async (res): Promise<MirrorProbe> => {
        if (!res.ok) {
          await res.body?.cancel().catch(() => {});
          return { base, ok: false, status: res.status, ms: Date.now() - started };
        }
        if (opts.expect) {
          const body = await readPageBody(res, base);
          if (!opts.expect.test(body)) {
            return {
              base,
              ok: false,
              impostor: true,
              status: res.status,
              ms: Date.now() - started,
              error: "answered, but the page is not the expected site",
            };
          }
        } else {
          // Health-only probes do not inspect the body; release the connection now.
          await res.body?.cancel().catch(() => {});
        }
        return { base, ok: true, status: res.status, ms: Date.now() - started };
      },
      undefined,
      opts.timeoutMs ?? TIMEOUT_MS
    );
  } catch (err) {
    return {
      base,
      ok: false,
      ms: Date.now() - started,
      error: errText(err),
    };
  }
}
