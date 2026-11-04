// Transport-neutral application layer. MCP and CLI adapters call these functions;
// this module owns orchestration and returns plain data plus an explicit outcome.

import { resetDeadCache, type DownloadProgress } from "./http.js";
import { MANIFEST } from "./pkg.js";
import { defaultOutputDir, fetchBook, saveBook } from "./acquire.js";
import { MIRROR_GROUPS, probeGroup, toHealthcheckGroup } from "./mirrors.js";
import { withSourceCircuit } from "./providers/circuit.js";
import {
  searchBooks,
  resolveDownloadReport,
  bookDetails,
  libgen,
  scihub,
  BOOK_SOURCES,
  DISABLED_BOOK_SOURCES,
} from "./providers/index.js";
import type { Paper, SourceId } from "./types.js";
import { z } from "zod";
import { BOOK_SOURCE_IDS } from "./types.js";

/** Shared argument schemas: adapters validate the same contract before dispatch. */
export const appSchemas = {
  md5: z.string().regex(/^[a-fA-F0-9]{32}$/, "must be a 32-char MD5 hash"),
  searchText: z.string().trim().min(1),
  sources: z.array(z.enum(BOOK_SOURCE_IDS)).min(1, "select at least one source").optional(),
  limit: z.number().int().min(1).max(100).optional(),
  timeoutMs: z.number().int().min(250).max(30000).optional(),
};

export interface AppResult<T = unknown> {
  data: T;
  ok: boolean;
}

const success = <T>(data: T): AppResult<T> => ({ data, ok: true });
const failure = <T>(data: T): AppResult<T> => ({ data, ok: false });

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/** Validate a caller-supplied filename independently of any transport. */
export function plainFileName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed === "." || trimmed === ".." || /[\\/:\0]/.test(trimmed)) {
    throw new Error(
      `filename must be a plain file name, not a path (got "${name}"). Use output_dir for the directory.`
    );
  }
  if (WINDOWS_RESERVED.test(trimmed)) {
    throw new Error(`"${name}" is a reserved device name on Windows; choose another filename.`);
  }
  if (trimmed.endsWith(".")) {
    throw new Error(`filename must not end with a dot (got "${name}"); Windows would silently change it.`);
  }
  return trimmed;
}

export interface DownloadContext {
  onProgress?: (progress: DownloadProgress) => Promise<void>;
  signal?: AbortSignal;
}

export async function appSearchBooks(input: {
  query: string; sources?: SourceId[]; limit?: number;
}): Promise<AppResult> {
  const sources = [...new Set(input.sources ?? BOOK_SOURCES)];
  const result = await searchBooks(input.query, sources, input.limit ?? 20);
  return success({ ...result, total: result.results.length, sourcesSearched: sources });
}

export async function appBookDetails(input: { md5: string }): Promise<AppResult> {
  const details = await bookDetails(input.md5.toLowerCase());
  return details.title ? success(details) : failure(details);
}

export async function appDownloadLinks(input: { md5: string }): Promise<AppResult> {
  const hash = input.md5.toLowerCase();
  const { links, errors, notFound } = await resolveDownloadReport(hash);
  const body = {
    md5: hash, count: links.length, links,
    ...(notFound.length ? { notFound } : {}),
    ...(errors.length ? { errors } : {}),
  };
  if (links.length > 0) return success(body);
  if (errors.length > 0) {
    return failure({
      ...body,
      reason: "No download link obtained, and at least one source was unavailable. Retry later or run healthcheck; the record may still exist.",
    });
  }
  return success({ ...body, reason: "No source has a download link for this md5." });
}

export async function appDownloadBook(
  input: { md5: string; output_dir?: string; filename?: string },
  context: DownloadContext = {},
): Promise<AppResult> {
  const hash = input.md5.toLowerCase();
  const plainName = input.filename === undefined ? undefined : plainFileName(input.filename);
  const outcome = await saveBook(hash, {
    outputDir: input.output_dir ?? defaultOutputDir(),
    plainName,
    onProgress: context.onProgress ?? (async () => {}),
    signal: context.signal,
  });
  return outcome.saved ? success(outcome.body) : failure(outcome.body);
}

export async function appFetchBook(
  input: { query: string; format?: string; output_dir?: string; max_attempts?: number; sources?: SourceId[] },
  context: DownloadContext = {},
): Promise<AppResult> {
  const body = await fetchBook({
    query: input.query,
    outputDir: input.output_dir ?? defaultOutputDir(),
    format: input.format,
    sources: input.sources,
    maxAttempts: input.max_attempts,
    onProgress: context.onProgress ?? (async () => {}),
    signal: context.signal,
  });
  return body.saved ? success(body) : failure(body);
}

const MAX_SEARCH_PDF_RESOLUTIONS = 3;

/** Best-effort enrichment; failures never discard successful paper search results. */
export async function resolvePaperPdfs(papers: Paper[]): Promise<Paper[]> {
  const pdfUrls = new Map<Paper, string>();
  const targets = papers
    .filter((paper): paper is Paper & { doi: string } => Boolean(paper.doi))
    .slice(0, MAX_SEARCH_PDF_RESOLUTIONS);
  await Promise.all(targets.map(async (paper) => {
    try {
      const resolved = await withSourceCircuit("scihub", () => scihub.resolve(paper.doi));
      if (resolved.pdfUrl) pdfUrls.set(paper, resolved.pdfUrl);
    } catch {
      // Optional PDF resolution is deliberately best-effort.
    }
  }));
  return papers.map((paper) => {
    const pdfUrl = pdfUrls.get(paper);
    return pdfUrl ? { ...paper, pdfUrl } : paper;
  });
}

export async function appSearchPapers(input: {
  query: string; limit?: number; resolvePdfs?: boolean;
}): Promise<AppResult> {
  const papers = await withSourceCircuit("libgen", () => libgen.searchPapers(input.query, input.limit ?? 20));
  const results = input.resolvePdfs ? await resolvePaperPdfs(papers) : papers;
  return success({ query: input.query, total: results.length, results });
}

export async function appGetPaper(input: { identifier: string }): Promise<AppResult> {
  return success(await withSourceCircuit("scihub", () => scihub.resolve(input.identifier)));
}

export async function appHealthcheck(input: { timeoutMs?: number } = {}): Promise<AppResult> {
  resetDeadCache();
  const probes = await Promise.all(MIRROR_GROUPS.map((group) => probeGroup(group, { timeoutMs: input.timeoutMs })));
  const groups = probes.map(toHealthcheckGroup);
  const reachable = probes.filter((group) => group.ok).map((group) => group.group);
  const impostors = probes.flatMap((group) => group.impostors);
  return success({
    version: MANIFEST.version,
    ready: reachable.length > 0,
    reachable,
    unreachable: groups.filter((group) => !group.ok).map((group) => group.group),
    impostors,
    defaults: { sources: BOOK_SOURCES, disabledByDefault: DISABLED_BOOK_SOURCES },
    groups,
  });
}
