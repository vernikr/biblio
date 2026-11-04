// Sci-Hub provider — academic papers by DOI / title / URL.

import * as cheerio from "cheerio";
import {
  fetchFromMirrors,
  MirrorRecordMissError,
  ResourceNotFoundError,
} from "../http.js";
import { SCIHUB_MIRRORS } from "../mirrors.js";
import { AsyncTtlCache, PROVIDER_CACHE_TTL_MS } from "../cache.js";
import { absoluteUrl } from "../parse.js";
import type { Paper } from "../types.js";

const GROUP = "scihub";

/** Sci-Hub sometimes answers HTTP 200 with a human-verification page (ALTCHA)
 *  instead of the article. That is a mirror failure, not a paper: the next
 *  mirror is tried, and if all of them challenge, the caller hears why. */
const CHALLENGE_PAGE = /altcha-widget|\/captcha\/solution\/|проверка на робота/i;

/** What one article page yields: the PDF location and the title. */
interface ArticlePage {
  pdfSrc?: string;
  title: string;
}

/** The PDF location on an article page, or undefined when the page holds none. */
function findPdfSrc($: cheerio.CheerioAPI, html: string): string | undefined {
  // The PDF lives in an <embed>/<iframe id="pdf"> or a "save" button onclick.
  let pdfSrc =
    $("embed#pdf").attr("src") ||
    $("iframe#pdf").attr("src") ||
    $("embed[type='application/pdf']").attr("src") ||
    $("#article embed").attr("src") ||
    $("#article iframe").attr("src") ||
    $("embed[src]").first().attr("src") ||
    "";

  if (!pdfSrc) {
    const onclick = $("a:contains('save'), button:contains('save')").attr("onclick") || "";
    const m = onclick.match(/location\.href=['"]([^'"]+)['"]/);
    if (m?.[1]) pdfSrc = m[1];
  }
  if (!pdfSrc) {
    const m = html.match(/(?:src|href)=["']([^"']+\.pdf[^"']*)["']/i);
    if (m?.[1]) pdfSrc = m[1];
  }

  // Strip viewer fragment (e.g. #view=FitH) from PDF URL.
  return pdfSrc ? pdfSrc.replace(/#.*$/, "") || undefined : undefined;
}

const NOT_IN_CATALOGUE =
  "not found — Sci-Hub has no PDF for this identifier (the page is not an article)";

/**
 * Parse one article page, and vouch for it during the mirror race. The parse is
 * handed back to the caller: the winning page used to be loaded by cheerio twice
 * more after the race had already validated it.
 */
function parseArticlePage(html: string, id: string): boolean | string | { value: ArticlePage } {
  if (CHALLENGE_PAGE.test(html)) {
    return "answered with a human-verification challenge (ALTCHA), not the article";
  }
  const $ = cheerio.load(html);
  const pdfSrc = findPdfSrc($, html);
  // A page without a PDF is a miss for this record, so another mirror may still win.
  if (!pdfSrc) throw new MirrorRecordMissError("answered without a PDF for this record");
  const title =
    $("#citation i").first().text().trim() ||
    $("title").text().trim() ||
    id;
  return { value: { pdfSrc, title } };
}

/** Resolutions are memoized for the short agent loop: the same DOI is resolved
 *  twice when a search asks for PDFs and the caller then follows up with
 *  get_paper. A miss is not cached — a paper that appears later is found. */
const resolutionCache = new AsyncTtlCache<string, Paper>(PROVIDER_CACHE_TTL_MS, 64);

/** Resolve a paper via Sci-Hub using a DOI, article URL, or title. */
export async function resolve(identifier: string): Promise<Paper> {
  const id = identifier.trim();
  return resolutionCache.getOrLoad(id, () => resolveUncached(id));
}

async function resolveUncached(id: string): Promise<Paper> {
  let fetched;
  try {
    fetched = await fetchFromMirrors(
      GROUP,
      SCIHUB_MIRRORS,
      (b) => `${b}/${encodeURIComponent(id)}`,
      undefined,
      (html) => parseArticlePage(html, id)
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw new ResourceNotFoundError(GROUP, error.tried, NOT_IN_CATALOGUE);
    }
    throw error;
  }
  const { base, finalUrl, parsed } = fetched;

  const pdfSrc = parsed?.pdfSrc;
  // A page without a PDF is a "not in our catalogue" answer, often HTTP 200 with
  // third-party links. Returning it as a paper would put the page title in
  // `title`, so report it as a missing record instead.
  if (!pdfSrc) throw new ResourceNotFoundError(GROUP, 1, NOT_IN_CATALOGUE);

  const doi = id.match(/10\.\d{4,9}\/\S+/)?.[0];

  return {
    source: "scihub",
    title: parsed?.title ?? id,
    doi,
    url: finalUrl,
    pdfUrl: absoluteUrl(pdfSrc, base),
    mirrors: SCIHUB_MIRRORS.map((m) => `${m}/${encodeURIComponent(id)}`),
  };
}
