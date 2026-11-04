// Anna's Archive provider.

import * as cheerio from "cheerio";
import {
  fetchFromMirrors,
  fetchWithTimeout,
  MirrorRecordMissError,
  probeMirror,
} from "../http.js";
import { ANNAS_IDENTITY, ANNAS_MIRRORS } from "../mirrors.js";
import { absoluteUrl, anchorsToLinks, parseLanguage, parseSize, parseYear } from "../parse.js";
import type { Book, DownloadLink } from "../types.js";

const GROUP = "annas";

/** Reject mirrors that answer 200 but are not Anna's Archive. */
const isAnnasArchive = (html: string): boolean | string => {
  if (/Anna[’']s Archive/i.test(html)) return true;
  return "answered but is not Anna's Archive (parked or hijacked domain?)";
};

/** Parse known fields from Anna's unstructured result metadata. */
function parseMeta(metaText: string): Partial<Book> {
  const out: Partial<Book> = {};
  const year = parseYear(metaText);
  if (year) out.year = year;
  const fmt = metaText.match(/\b(pdf|epub|mobi|djvu|azw3|cbr|cbz|fb2)\b/i)?.[1];
  if (fmt) out.format = fmt.toUpperCase();
  const size = parseSize(metaText);
  if (size) out.size = size;
  const lang = parseLanguage(metaText);
  if (lang) out.language = lang;
  return out;
}

export async function search(query: string, limit: number): Promise<Book[]> {
  const { html, base } = await fetchFromMirrors(
    GROUP,
    ANNAS_MIRRORS,
    (b) => `${b}/search?q=${encodeURIComponent(query)}`,
    undefined,
    isAnnasArchive
  );
  const books: Book[] = [];
  const seen = new Set<string>();

  // Each record is an <a href="/md5/HASH"> block. Anna's ships some results
  // inside HTML comments (lazy-render); strip comment markers first so the
  // parser sees them too.
  const normalized = html.replace(/<!--|-->/g, "");
  const $$ = cheerio.load(normalized);

  $$('a[href^="/md5/"]').each((_i, el) => {
    if (books.length >= limit) return false;
    const href = $$(el).attr("href") || "";
    const md5 = href.match(/\/md5\/([a-f0-9]{32})/)?.[1];
    if (!md5 || seen.has(md5)) return;

    const block = $$(el);
    const text = block.text().replace(/\s+/g, " ").trim();
    // Title is the most prominent text node; fall back to the block text.
    const title =
      block.find("h3").first().text().trim() ||
      block.find(".text-xl, .font-bold, .text-lg").first().text().trim() ||
      text.slice(0, 120);
    if (!title) return;

    const coverSrc = block.find("img").first().attr("src");
    const coverUrl = absoluteUrl(coverSrc, base);
    // Metadata typically lives in sibling divs after the cover anchor.
    const metaText = block.parent().text().replace(/\s+/g, " ").trim();

    seen.add(md5);
    books.push({
      source: "annas",
      md5,
      title,
      url: `${base}/md5/${md5}`,
      coverUrl,
      ...parseMeta(metaText),
    });
  });

  return books;
}

/** Fetch the md5 detail page and extract structured metadata + links. */
export async function details(
  md5: string,
  signal?: AbortSignal
): Promise<Book & { downloadLinks: DownloadLink[] }> {
  const { html, base } = await fetchFromMirrors(
    GROUP,
    ANNAS_MIRRORS,
    (b) => `${b}/md5/${md5}`,
    signal ? { signal } : undefined,
    isAnnasArchive
  );
  const $ = cheerio.load(html);

  const title = $("h1").first().text().trim() || $("title").text().trim();
  const metaText = $("main, body").text().replace(/\s+/g, " ").trim();

  const downloadLinks = extractDownloadLinks($, base);

  return {
    source: "annas",
    md5,
    title,
    url: `${base}/md5/${md5}`,
    ...parseMeta(metaText),
    downloadLinks,
  };
}

/** Host -> time until which its identity check still holds. */
const verifiedUntil = new Map<string, number>();
const IDENTITY_TTL_MS = 10 * 60_000;

/** Mirrors whose homepage proves they are Anna's Archive. Checked without the
 *  key, so a squatted or mistyped host never receives the member secret. */
async function identityVerifiedMirrors(): Promise<string[]> {
  const now = Date.now();
  const unknown = ANNAS_MIRRORS.filter((base) => (verifiedUntil.get(base) ?? 0) <= now);
  if (unknown.length > 0) {
    const probes = await Promise.all(
      unknown.map((base) => probeMirror(base, "/", { expect: ANNAS_IDENTITY }))
    );
    for (const probe of probes) {
      if (probe.ok) verifiedUntil.set(probe.base, now + IDENTITY_TTL_MS);
    }
  }
  return ANNAS_MIRRORS.filter((base) => (verifiedUntil.get(base) ?? 0) > Date.now());
}

/** A member link is worth waiting for, but not for a dead mirror's full budget. */
const FAST_DOWNLOAD_TIMEOUT_MS = 20_000;

/** Use Anna's member API for verified direct downloads when an API key is set.
 *
 *  Returns a link, or `null` when no key is configured or the record is absent
 *  from every verified mirror. Throws when the member API could not answer at
 *  all, so the caller can tell a dead API from a missing record. */
export async function fastDownload(md5: string): Promise<DownloadLink | null> {
  const key = process.env.BIBLIO_ANNAS_API_KEY?.trim();
  if (!key) return null;

  const mirrors = await identityVerifiedMirrors();
  if (mirrors.length === 0) {
    throw new Error("no Anna's Archive mirror passed the identity check for the member API");
  }
  const cancels = mirrors.map(() => new AbortController());

  // Ask every verified mirror at once; the first usable answer wins and the
  // rest are cancelled. Sequential tries cost one full timeout per dead mirror.
  const attempts = mirrors.map((base, i) =>
    fetchWithTimeout(
      `${base}/dyn/api/fast_download.json?md5=${md5}&key=${encodeURIComponent(key)}`,
      {},
      async (res) => {
        // 404 and a body without a link both mean "this mirror has no such record".
        if (res.status === 404) {
          await res.body?.cancel().catch(() => {});
          throw new MirrorRecordMissError("no member record for this md5");
        }
        if (!res.ok) {
          await res.body?.cancel().catch(() => {});
          throw new Error(`HTTP ${res.status}`);
        }
        const data: any = await res.json();
        const url: unknown = data?.download_url ?? data?.url;
        if (typeof url !== "string" || !url) {
          throw new MirrorRecordMissError("no member download for this md5");
        }

        // Surface remaining quota when the API reports it, so a run can see it
        // is burning through the daily allowance.
        const left =
          data?.account_fast_download_info?.downloads_left ??
          data?.downloads_left;
        const label =
          typeof left === "number"
            ? `Anna's Archive fast download (member, ${left} left today)`
            : "Anna's Archive fast download (member)";

        return { source: "annas" as const, label, url, direct: true, verified: true };
      },
      cancels[i]!.signal,
      FAST_DOWNLOAD_TIMEOUT_MS
    )
  );

  try {
    const link = await Promise.any(attempts);
    cancels.forEach((cancel) => cancel.abort());
    return link;
  } catch (error) {
    const reasons: unknown[] = (error as AggregateError).errors ?? [];
    // Every mirror answered that the record is absent: a healthy "no".
    if (reasons.length > 0 && reasons.every((r) => r instanceof MirrorRecordMissError)) {
      return null;
    }
    // Otherwise at least one mirror failed to answer usefully: an outage.
    // Reason text carries status codes only, never the key-bearing URL.
    const summary = reasons
      .map((r) => (r instanceof Error ? r.message : String(r)))
      .map((m) => m.replace(/https?:\/\/\S+/g, "mirror"))
      .join("; ");
    throw new Error(`All ${mirrors.length} annas mirror(s) failed for the member API: ${summary}`);
  }
}

function extractDownloadLinks($: cheerio.CheerioAPI, base: string): DownloadLink[] {
  return anchorsToLinks($, base, (href, url, text) => {
    const isDownload =
      /\/(slow_download|fast_download|download)\//.test(href) ||
      /ipfs/i.test(href) ||
      /^download/i.test(text) ||
      /download now|option #/i.test(text);
    if (!isDownload) return null;
    return {
      source: "annas",
      label: text.slice(0, 80),
      direct: /ipfs|\.(pdf|epub|mobi|djvu)(\?|$)/i.test(url),
    };
  });
}
