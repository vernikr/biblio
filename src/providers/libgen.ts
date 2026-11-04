// Library Genesis provider.

import * as cheerio from "cheerio";
import { AsyncTtlCache, PROVIDER_CACHE_TTL_MS } from "../cache.js";
import { fetchFromMirrors } from "../http.js";
import { LIBGEN_MIRRORS } from "../mirrors.js";
import {
  anchorsToLinks,
  columnMap,
  isIsbnLike,
  isUsefulLink,
  LIBGEN_DEFAULT_COLUMNS,
  parseBibtex,
  parseFormat,
  parseIsbns,
  parseLanguage,
  parsePages,
  parseSize,
  parseYear,
  type LibgenColumn,
} from "../parse.js";
import type { Book, DownloadLink, Paper } from "../types.js";

const GROUP = "libgen";

function requestedResultRows(limit: number): number {
  const count = Number.isFinite(limit) ? Math.ceil(limit * 3) : 100;
  return Math.max(25, Math.min(100, count));
}

const adsPageCache = new AsyncTtlCache<string, { html: string; base: string }>(
  PROVIDER_CACHE_TTL_MS,
  64
);

function fetchAdsPage(md5: string): Promise<{ html: string; base: string }> {
  const hash = md5.toLowerCase();
  return adsPageCache.getOrLoad(hash, async () => {
    const { html, base } = await fetchFromMirrors(GROUP, LIBGEN_MIRRORS, (mirror) =>
      `${mirror}/ads.php?md5=${hash}`
    );
    return { html, base };
  });
}

/** Selection type derived from the installed Cheerio API. */
type Selection = ReturnType<cheerio.CheerioAPI>;

/** Read a mapped column from a row, tolerating a missing mapping or cell. */
function cellText(
  cells: Selection,
  cols: Partial<Record<LibgenColumn, number>>,
  field: LibgenColumn
): string | undefined {
  const index = cols[field];
  if (index === undefined) return undefined;
  const el = cells.eq(index);
  if (el.length === 0) return undefined;
  const text = el.text().replace(/\s+/g, " ").trim();
  return text || undefined;
}

/** Column indices for this table, from its header row when it has one. */
function resolveColumns($: cheerio.CheerioAPI): Partial<Record<LibgenColumn, number>> {
  const headerRow = $("table tr")
    .filter((_i, row) => $(row).find("th").length > 0)
    .first();
  const headers = headerRow
    .find("th")
    .map((_i, th) => $(th).text())
    .get() as string[];
  const mapped = columnMap(headers);
  // Scimag rows can contain an unlabelled status cell before the data columns.
  // The corresponding header row has a plain <td> before its <th>s; shift both
  // detected and fallback indices by that count so columns stay aligned.
  const offset = headers.length > 0 ? headerRow.children("td").length : 0;
  const shift = (
    columns: Partial<Record<LibgenColumn, number>>
  ): Partial<Record<LibgenColumn, number>> => {
    const result: Partial<Record<LibgenColumn, number>> = {};
    for (const field of Object.keys(columns) as LibgenColumn[]) {
      const index = columns[field];
      if (index !== undefined) result[field] = index + offset;
    }
    return result;
  };
  // Anything the header row did not name falls back to the common layout, so a
  // partially-rendered header cannot blank out fields.
  return { ...shift(LIBGEN_DEFAULT_COLUMNS), ...shift(mapped) };
}

/** Split the wide "Title / Series" column into its parts. */
function splitTitleCell(
  $: cheerio.CheerioAPI,
  cell: Selection
): { title?: string; series?: string; isbn?: string; venue?: string } {
  const series = cell.find("b").first().text().replace(/\s+/g, " ").trim() || undefined;

  const anchors: Array<{ href?: string; text: string; insideBold: boolean }> = [];
  cell.find("a").each((_i, el) => {
    anchors.push({
      href: $(el).attr("href"),
      text: $(el).text().replace(/\s+/g, " ").trim(),
      insideBold: $(el).parents("b").length > 0,
    });
  });
  const venue = anchors.find((a) => /series\.php/i.test(a.href ?? ""))?.text || series;

  let title: string | undefined;
  let isbn: string | undefined;
  for (const a of anchors) {
    if (!a.text) continue;
    if (isIsbnLike(a.text)) {
      isbn ??= parseIsbns(a.text);
      continue;
    }
    // Skip venue/issue links in the bold block and single-letter record badges.
    if (a.insideBold || a.text.length <= 2) continue;
    title ??= a.text;
  }

  if (!title) {
    // No usable title anchor: remove the bold series/venue, type badges and ISBN.
    const raw = cell.text().replace(/\s+/g, " ").trim();
    const withoutSeries = series ? raw.replace(series, "").trim() : raw;
    const cleaned = withoutSeries
      .replace(/\b[bl]\s+\d{4,}\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    isbn ??= parseIsbns(cleaned);
    const noIsbn = cleaned
      .replace(/(?:\d[\dXx-]{8,16}\d)(?:\s*;\s*\d[\dXx-]{8,16}\d)*/g, "")
      .replace(/\s+/g, " ")
      .trim();
    title = (noIsbn || cleaned).slice(0, 300) || undefined;
  }

  return { title, series, isbn, venue };
}

/** Visit every table row with its serialised HTML, once. Return false to stop. */
function forEachRow(
  $: cheerio.CheerioAPI,
  visit: (row: cheerio.Cheerio<any>, rowHtml: string) => boolean | void
): void {
  $("table tr").each((_i, row) => {
    const $row = $(row);
    return visit($row, $row.html() || "");
  });
}

/** Search Library Genesis scimag (academic articles) by keyword or DOI. */
export async function searchPapers(query: string, limit: number): Promise<Paper[]> {
  // topics[]=a scopes the search to scimag (articles). The alternate route is
  // tried on the same mirror only when the first path is missing.
  const rows = requestedResultRows(limit);
  const encoded = encodeURIComponent(query);
  const { html, base } = await fetchFromMirrors(GROUP, LIBGEN_MIRRORS, (b) => [
    `${b}/index.php?req=${encoded}&topics%5B%5D=a&res=${rows}`,
    `${b}/scimag/?q=${encoded}&res=${rows}`,
  ]);

  const $ = cheerio.load(html);
  const cols = resolveColumns($);
  const papers: Paper[] = [];
  const seen = new Set<string>();

  forEachRow($, ($row, rowHtml) => {
    if (papers.length >= limit) return false;
    const doi = rowHtml.match(/10\.\d{4,9}\/[^\s"'<>]+/)?.[0];
    const md5 = rowHtml.match(/md5=([a-f0-9]{32})/i)?.[1]?.toLowerCase();
    const key = doi || md5;
    if (!key || seen.has(key)) return;

    const cells = $row.find("td");
    if (cells.length < 3) return;

    const titleCell = cells.eq(cols.title ?? 0);
    const { title: fromCell, venue } = splitTitleCell($, titleCell);
    let title = fromCell;

    // The scimag title cell sometimes holds the venue rather than the article
    // title; the longest meaningful anchor is a better candidate there.
    if (!title) {
      $row.find("a").each((_j, a) => {
        const t = $(a).text().replace(/\s+/g, " ").trim();
        if (t.length > (title?.length ?? 0) && !/^\d+$/.test(t)) title = t;
      });
    }
    if (!title || title.length < 4) return;

    seen.add(key);
    papers.push({
      source: "libgen",
      title,
      author: cellText(cells, cols, "author"),
      doi,
      year: parseYear(cellText(cells, cols, "year")),
      journal: venue ?? cellText(cells, cols, "publisher"),
      url: md5 ? `${base}/ads.php?md5=${md5}` : undefined,
      mirrors: md5 ? [`${base}/ads.php?md5=${md5}`] : undefined,
    });
  });

  return papers;
}

export async function search(query: string, limit: number): Promise<Book[]> {
  // Try the .li-family route, then its legacy alternative on the same mirror
  // only if that route is absent; do not make a second full mirror round.
  const rows = requestedResultRows(limit);
  const encoded = encodeURIComponent(query);
  const { html, base } = await fetchFromMirrors(GROUP, LIBGEN_MIRRORS, (b) => [
    `${b}/index.php?req=${encoded}&res=${rows}`,
    `${b}/search.php?req=${encoded}&res=${rows}&column=def`,
  ]);

  const $ = cheerio.load(html);
  const cols = resolveColumns($);
  const books: Book[] = [];
  const seen = new Set<string>();

  forEachRow($, ($row, rowHtml) => {
    if (books.length >= limit) return false;
    const md5 =
      rowHtml.match(/md5=([a-f0-9]{32})/i)?.[1]?.toLowerCase() ||
      rowHtml.match(/\/md5\/([a-f0-9]{32})/i)?.[1]?.toLowerCase();
    if (!md5 || seen.has(md5)) return;

    const cells = $row.find("td");
    if (cells.length < 3) return;

    const { title, series, isbn } = splitTitleCell($, cells.eq(cols.title ?? 0));
    if (!title) return;

    const author = cellText(cells, cols, "author");

    seen.add(md5);
    books.push({
      source: "libgen",
      md5,
      title,
      series,
      // An author that is really an ISBN list is worse than no author.
      author: author && !isIsbnLike(author) ? author : undefined,
      publisher: cellText(cells, cols, "publisher"),
      year: parseYear(cellText(cells, cols, "year")),
      language: parseLanguage(cellText(cells, cols, "language")),
      pages: parsePages(cellText(cells, cols, "pages")),
      format: parseFormat(cellText(cells, cols, "format")),
      size: parseSize(cellText(cells, cols, "size")),
      isbn: isbn ?? parseIsbns(cellText(cells, cols, "title")),
      url: `${base}/ads.php?md5=${md5}`,
    });
  });

  return books;
}

/** Full metadata for an md5, from the BibTeX block Libgen embeds on ads.php. */
export async function details(md5: string): Promise<Book & { downloadLinks: DownloadLink[] }> {
  const hash = md5.toLowerCase();
  const { html, base } = await fetchAdsPage(hash);

  const $ = cheerio.load(html);
  const bodyText = $("body").text().replace(/\s+/g, " ");
  const bibtex = parseBibtex(bodyText);

  const title = bibtex.title || $("h1").first().text().trim() || undefined;
  if (!title) {
    throw new Error(
      `Libgen returned no parseable metadata for ${md5} (page ${html.length} bytes)`
    );
  }

  // Filtered here as well, not only in resolveDownloads(): book_details embeds
  // this list, and an agent following "http://annas-archive.org/" out of a
  // details response gets nothing with no explanation. Reuses the DOM above.
  const links = extractDownloadLinks($, base).filter((l) => isUsefulLink(l.url, hash));

  return {
    source: "libgen",
    md5: hash,
    title,
    series: bibtex.series || undefined,
    author: bibtex.author || undefined,
    publisher: bibtex.publisher || undefined,
    year: parseYear(bibtex.year),
    isbn: bibtex.isbn || undefined,
    url: `${base}/ads.php?md5=${hash}`,
    downloadLinks: links,
  };
}

/** Resolve every candidate download URL for an md5. */
export async function downloadLinks(md5: string): Promise<DownloadLink[]> {
  const { html, base } = await fetchAdsPage(md5);
  return extractDownloadLinks(cheerio.load(html), base);
}

/** Download candidates from an already-parsed ads.php page. */
export function extractDownloadLinks($: cheerio.CheerioAPI, base: string): DownloadLink[] {
  return anchorsToLinks(
    $,
    base,
    (href, _url, text) => {
      if (/get\.php\?/i.test(href)) return { source: "libgen", label: "Libgen direct (get.php)", direct: true };
      if (/\/get\b|cdn|download/i.test(href) && /^(get|download|libgen)/i.test(text))
        return { source: "libgen", label: text, direct: true };
      if (/(annas-archive|libgen\.pw|randombook)/i.test(href))
        return { source: "libgen", label: `mirror: ${text || href}`, direct: false };
      return null;
    },
    { dedupe: true }
  );
}
