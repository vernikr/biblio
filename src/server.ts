// MCP tool surface.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resetDeadCache, type DownloadProgress } from "./http.js";
import { MANIFEST } from "./pkg.js";
import { defaultOutputDir, fetchBook, saveBook } from "./acquire.js";
import { MIRROR_GROUPS, probeGroup, toHealthcheckGroup } from "./mirrors.js";
import { describeArgsError, toolDescription } from "./toolmeta.js";
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
import { BOOK_SOURCE_IDS } from "./types.js";
import type { Paper } from "./types.js";

const SERVER_NAME = "biblio-mcp";

const SERVER_VERSION: string = MANIFEST.version;

const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

/** Same body as `json`, flagged so clients see a failed outcome as a failure. */
const jsonError = (data: unknown) => ({ ...json(data), isError: true });

/** Build a throttled progress reporter for one tool call. */
export function makeProgressReporter(extra?: {
  _meta?: { progressToken?: string | number };
  sendNotification?: (n: never) => Promise<void>;
}) {
  const token = extra?._meta?.progressToken;
  const send = extra?.sendNotification;
  if (token === undefined || typeof send !== "function") {
    return async (_p: DownloadProgress) => {};
  }
  const MIN_INTERVAL_MS = 250;
  let lastSent = 0;
  return async ({ bytes, total }: DownloadProgress) => {
    const now = Date.now();
    const done = total !== undefined && bytes >= total;
    if (!done && now - lastSent < MIN_INTERVAL_MS) return;
    lastSent = now;
    try {
      await send({
        method: "notifications/progress",
        params: {
          progressToken: token,
          progress: bytes,
          ...(total !== undefined ? { total } : {}),
          message: total
            ? `${(bytes / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`
            : `${(bytes / 1048576).toFixed(1)} MB`,
        },
      } as never);
    } catch {
      // Progress is best-effort; a disconnected client must not reject from
      // this fire-and-forget callback and become an unhandled rejection.
    }
  };
}

function useReadableValidationErrors(server: McpServer): void {
  // The SDK invokes this private method dynamically, so an instance override is enough.
  type ValidatingServer = {
    validateToolInput: (tool: unknown, args: unknown, toolName: string) => Promise<unknown>;
  };
  const target = server as unknown as Partial<ValidatingServer>;
  if (typeof target.validateToolInput !== "function") {
    // Say so rather than letting a future SDK bump quietly hand every agent raw
    // Zod dumps again. Degraded error messages beat a server that will not start.
    console.error(
      "biblio-mcp: this @modelcontextprotocol/sdk version does not expose " +
        "validateToolInput, so argument errors will not be translated."
    );
    return;
  }
  const original = target.validateToolInput.bind(server);

  target.validateToolInput = async (tool, args, toolName) => {
    // The tool's own schema answers first: the sentence an agent reads never
    // depends on how a particular SDK build renders its own error text.
    const inputSchema =
      tool && typeof tool === "object" ? (tool as { inputSchema?: unknown }).inputSchema : undefined;
    const problem = describeArgsError(String(toolName), args, inputSchema);
    if (problem) throw new Error(problem);
    // Valid here by the same schema the SDK is about to apply.
    return await original(tool, args, toolName);
  };
}

/** Device names Windows cannot use as a file, with or without an extension. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/**
 * A caller-supplied filename is one plain name: no separators, drive prefixes,
 * NUL bytes, or the `.`/`..` entries that climb out of the directory.
 *
 * Also refused are names Windows would reject or silently change — a file saved
 * under a name other than the one reported back is the worse of the two, and
 * the Desktop extension is Windows-first.
 */
function plainFileName(name: string): string {
  const trimmed = name.trim();
  if (
    trimmed === "" ||
    trimmed === "." ||
    trimmed === ".." ||
    /[\\/:\0]/.test(trimmed)
  ) {
    throw new Error(
      `filename must be a plain file name, not a path (got "${name}"). ` +
        "Use output_dir for the directory."
    );
  }
  if (WINDOWS_RESERVED.test(trimmed)) {
    throw new Error(`"${name}" is a reserved device name on Windows; choose another filename.`);
  }
  // Windows drops a trailing dot, so "book.pdf." would save as "book.pdf".
  if (trimmed.endsWith(".")) {
    throw new Error(
      `filename must not end with a dot (got "${name}"); Windows would silently change it.`
    );
  }
  // A name too long for the filesystem is the one case the OS reports clearly
  // on every platform, so it is left to the OS.
  return trimmed;
}

const MAX_SEARCH_PDF_RESOLUTIONS = 3;

/** Best-effort, bounded Sci-Hub enrichment; search results must survive mirror failures. */
export async function resolvePaperPdfs(papers: Paper[]): Promise<Paper[]> {
  const pdfUrls = new Map<Paper, string>();
  const targets = papers
    .filter((paper): paper is Paper & { doi: string } => Boolean(paper.doi))
    .slice(0, MAX_SEARCH_PDF_RESOLUTIONS);

  // The lookups are independent, so they run together; the cap bounds the load.
  await Promise.all(
    targets.map(async (paper) => {
      try {
        const resolved = await withSourceCircuit("scihub", () => scihub.resolve(paper.doi));
        if (resolved.pdfUrl) pdfUrls.set(paper, resolved.pdfUrl);
      } catch {
        // Optional PDF resolution never turns a successful Libgen search into an error.
      }
    })
  );

  return papers.map((paper) => {
    const pdfUrl = pdfUrls.get(paper);
    return pdfUrl ? { ...paper, pdfUrl } : paper;
  });
}

/** One rule for every tool that takes a catalogue hash. */
const md5Schema = z.string().regex(/^[a-fA-F0-9]{32}$/, "must be a 32-char MD5 hash");
const searchTextSchema = z.string().trim().min(1);

export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  useReadableValidationErrors(server);

  // -------------------------------------------------------------------------
  // search_books — the headline tool
  // -------------------------------------------------------------------------
  server.tool(
    "search_books",
    toolDescription("search_books"),
    {
      query: searchTextSchema.describe("Title, author, ISBN, or topic to search for."),
      sources: z
        .array(z.enum(BOOK_SOURCE_IDS))
        .min(1, "select at least one source")
        .optional()
        .describe(
          `Which sources to search; pass at least one. Duplicate names are ignored. Default: ${BOOK_SOURCES.join(", ")}.` +
            (DISABLED_BOOK_SOURCES.length
              ? ` (${DISABLED_BOOK_SOURCES.join(", ")} excluded by default — pass it` +
                ` explicitly to include; see BIBLIO_DISABLE_SOURCES.)`
              : "")
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max results per source (default 20)."),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ query, sources, limit }) => {
      const selectedSources = [...new Set(sources ?? BOOK_SOURCES)];
      const result = await searchBooks(query, selectedSources, limit ?? 20);
      return json({
        ...result,
        total: result.results.length,
        sourcesSearched: selectedSources,
      });
    }
  );

  // -------------------------------------------------------------------------
  // book_details — full metadata + download options for one record
  // -------------------------------------------------------------------------
  server.tool(
    "book_details",
    toolDescription("book_details"),
    {
      md5: md5Schema,
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ md5 }) => {
      const details = await bookDetails(md5.toLowerCase());
      // No usable metadata from any source is a failed lookup, not a book.
      return details.title ? json(details) : jsonError(details);
    }
  );

  // -------------------------------------------------------------------------
  // get_download_links — every resolvable download URL for an md5
  // -------------------------------------------------------------------------
  server.tool(
    "get_download_links",
    toolDescription("get_download_links"),
    {
      md5: md5Schema,
    },
    { openWorldHint: true },
    async ({ md5 }) => {
      const hash = md5.toLowerCase();
      const { links, errors, notFound } = await resolveDownloadReport(hash);
      const body = {
        md5: hash,
        count: links.length,
        links,
        ...(notFound.length ? { notFound } : {}),
        ...(errors.length ? { errors } : {}),
      };
      if (links.length > 0) return json(body);
      // No links and some source unavailable: the empty list proves nothing.
      if (errors.length > 0) {
        return jsonError({
          ...body,
          reason:
            "No download link obtained, and at least one source was unavailable. " +
            "Retry later or run healthcheck; the record may still exist.",
        });
      }
      // Every source answered and none has a link for this md5: a clean "no".
      return json({ ...body, reason: "No source has a download link for this md5." });
    }
  );

  // -------------------------------------------------------------------------
  // download_book — fetch the file to disk
  // -------------------------------------------------------------------------
  server.tool(
    "download_book",
    toolDescription("download_book"),
    {
      md5: md5Schema,
      output_dir: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Directory to save into; created if missing. Default: ~/Downloads/biblio-mcp. " +
            "Use an absolute path. A relative path is resolved against $HOME (not the " +
            "server's working directory, which you cannot see), and the resolved directory " +
            "is reported back as `outputDir`."
        ),
      filename: z
        .string()
        .optional()
        .describe("Optional plain filename; defaults to <md5>.<ext>. Existing names are never overwritten."),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async ({ md5, output_dir, filename }, extra) => {
      const hash = md5.toLowerCase();
      // Validate before any network work: a bad name must never reach the disk.
      const plainName = filename === undefined ? undefined : plainFileName(filename);
      const outcome = await saveBook(hash, {
        outputDir: output_dir ?? defaultOutputDir(),
        plainName,
        onProgress: makeProgressReporter(extra),
        signal: extra?.signal,
      });
      return outcome.saved ? json(outcome.body) : jsonError(outcome.body);
    }
  );

  // -------------------------------------------------------------------------
  // fetch_book — one call from a title to a verified file
  // -------------------------------------------------------------------------
  server.tool(
    "fetch_book",
    toolDescription("fetch_book"),
    {
      query: searchTextSchema.describe("Title, optionally with the author or edition, e.g. \"Algorithmic Trading Chan\"."),
      format: z
        .string()
        .min(1)
        .optional()
        .describe("Preferred format, e.g. PDF or EPUB. Default: PDF first, then EPUB."),
      output_dir: z
        .string()
        .min(1)
        .optional()
        .describe("Directory to save into. Default: ~/Downloads/biblio-mcp. Use an absolute path."),
      max_attempts: z
        .number()
        .int()
        .min(1)
        .max(5)
        .optional()
        .describe("How many copies to try, in order, before giving up (default 3)."),
      sources: z
        .array(z.enum(BOOK_SOURCE_IDS))
        .min(1, "select at least one source")
        .optional()
        .describe("Which sources to search. Default: the same as search_books."),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async ({ query, format, output_dir, max_attempts, sources }, extra) => {
      const body = await fetchBook({
        query,
        outputDir: output_dir ?? defaultOutputDir(),
        format,
        sources,
        maxAttempts: max_attempts,
        onProgress: makeProgressReporter(extra),
        signal: extra?.signal,
      });
      return body.saved ? json(body) : jsonError(body);
    }
  );

  // -------------------------------------------------------------------------
  // search_papers — academic articles via Library Genesis scimag
  // -------------------------------------------------------------------------
  server.tool(
    "search_papers",
    toolDescription("search_papers"),
    {
      query: searchTextSchema.describe("Keywords, title, author, or DOI."),
      limit: z.number().int().min(1).max(100).optional(),
      resolvePdfs: z
        .boolean()
        .optional()
        .describe(
          "Best-effort direct PDF lookup via Sci-Hub for up to three DOI results; adds network requests."
        ),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ query, limit, resolvePdfs: shouldResolvePdfs }) => {
      const papers = await withSourceCircuit("libgen", () =>
        libgen.searchPapers(query, limit ?? 20)
      );
      const results = shouldResolvePdfs ? await resolvePaperPdfs(papers) : papers;
      return json({ query, total: results.length, results });
    }
  );

  // -------------------------------------------------------------------------
  // get_paper — resolve a PDF via Sci-Hub by DOI / URL / title
  // -------------------------------------------------------------------------
  server.tool(
    "get_paper",
    toolDescription("get_paper"),
    {
      identifier: searchTextSchema
        .describe("DOI (e.g. 10.1038/nature12373), article URL, or title."),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ identifier }) =>
      json(await withSourceCircuit("scihub", () => scihub.resolve(identifier)))
  );

  // -------------------------------------------------------------------------
  // healthcheck — is anything reachable, without touching a catalogue
  // -------------------------------------------------------------------------
  server.tool(
    "healthcheck",
    toolDescription("healthcheck"),
    {
      timeoutMs: z
        .number()
        .int()
        .min(250)
        .max(30000)
        .optional()
        .describe("Per-mirror probe timeout in ms (default 8000)."),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ timeoutMs }) => {
      // Bypass the negative cache: the point of a healthcheck is to show what is
      // reachable right now, not what was unreachable a minute ago.
      resetDeadCache();
      const probes = await Promise.all(
        MIRROR_GROUPS.map((group) => probeGroup(group, { timeoutMs }))
      );
      const groups = probes.map(toHealthcheckGroup);
      const reachable = probes.filter((group) => group.ok).map((group) => group.group);
      const impostors = probes.flatMap((group) => group.impostors);
      return json({
        version: SERVER_VERSION,
        ready: reachable.length > 0,
        reachable,
        unreachable: groups.filter((g) => !g.ok).map((g) => g.group),
        // Called out separately because it is a different failure from "down":
        // the host answers, so a status-code-only check would call it healthy.
        impostors,
        defaults: { sources: BOOK_SOURCES, disabledByDefault: DISABLED_BOOK_SOURCES },
        groups,
      });
    }
  );

  return server;
}

export { SERVER_NAME, SERVER_VERSION };
