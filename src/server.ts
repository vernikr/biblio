// MCP transport adapter. Business orchestration lives in application.ts.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DownloadProgress } from "./http.js";
import { MANIFEST } from "./pkg.js";
import { describeArgsError, toolDescription } from "./toolmeta.js";
import {
  appSearchBooks,
  appBookDetails,
  appDownloadLinks,
  appDownloadBook,
  appFetchBook,
  appSearchPapers,
  appGetPaper,
  appHealthcheck,
  resolvePaperPdfs,
  appSchemas,
} from "./application.js";
import { BOOK_SOURCES, DISABLED_BOOK_SOURCES } from "./providers/index.js";

const SERVER_NAME = "biblio-mcp";
const SERVER_VERSION: string = MANIFEST.version;

const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});
const jsonError = (data: unknown) => ({ ...json(data), isError: true });

/** Build a throttled MCP progress reporter; application code only sees a callback. */
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
      // Progress is best-effort.
    }
  };
}

function useReadableValidationErrors(server: McpServer): void {
  type ValidatingServer = {
    validateToolInput: (tool: unknown, args: unknown, toolName: string) => Promise<unknown>;
  };
  const target = server as unknown as Partial<ValidatingServer>;
  if (typeof target.validateToolInput !== "function") {
    console.error(
      "biblio-mcp: this @modelcontextprotocol/sdk version does not expose " +
        "validateToolInput, so argument errors will not be translated."
    );
    return;
  }
  const original = target.validateToolInput.bind(server);
  target.validateToolInput = async (tool, args, toolName) => {
    const inputSchema =
      tool && typeof tool === "object" ? (tool as { inputSchema?: unknown }).inputSchema : undefined;
    const problem = describeArgsError(String(toolName), args, inputSchema);
    if (problem) throw new Error(problem);
    return await original(tool, args, toolName);
  };
}


export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  useReadableValidationErrors(server);

  server.tool(
    "search_books",
    toolDescription("search_books"),
    {
      query: appSchemas.searchText.describe("Title, author, ISBN, or topic to search for."),
      sources: appSchemas.sources
        .describe(
          `Which sources to search; pass at least one. Duplicate names are ignored. Default: ${BOOK_SOURCES.join(", ")}.` +
          (DISABLED_BOOK_SOURCES.length
            ? ` (${DISABLED_BOOK_SOURCES.join(", ")} excluded by default — pass it explicitly to include; see BIBLIO_DISABLE_SOURCES.)`
            : "")
        ),
      limit: appSchemas.limit
        .describe("Max results per source (default 20)."),
    },
    { readOnlyHint: true, openWorldHint: true },
    async (args) => {
      const result = await appSearchBooks(args);
      return json(result.data);
    }
  );

  server.tool(
    "book_details",
    toolDescription("book_details"),
    { md5: appSchemas.md5 },
    { readOnlyHint: true, openWorldHint: true },
    async ({ md5 }) => {
      const result = await appBookDetails({ md5 });
      return result.ok ? json(result.data) : jsonError(result.data);
    }
  );

  server.tool(
    "get_download_links",
    toolDescription("get_download_links"),
    { md5: appSchemas.md5 },
    { openWorldHint: true },
    async ({ md5 }) => {
      const result = await appDownloadLinks({ md5 });
      return result.ok ? json(result.data) : jsonError(result.data);
    }
  );

  server.tool(
    "download_book",
    toolDescription("download_book"),
    {
      md5: appSchemas.md5,
      output_dir: z.string().min(1).optional()
        .describe(
          "Directory to save into; created if missing. Default: ~/Downloads/biblio-mcp. " +
          "Use an absolute path. A relative path is resolved against $HOME (not the " +
          "server's working directory, which you cannot see), and the resolved directory " +
          "is reported back as `outputDir`."
        ),
      filename: z.string().optional()
        .describe("Optional plain filename; defaults to <md5>.<ext>. Existing names are never overwritten."),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async ({ md5, output_dir, filename }, extra) => {
      const result = await appDownloadBook(
        { md5, output_dir, filename },
        { onProgress: makeProgressReporter(extra), signal: extra?.signal }
      );
      return result.ok ? json(result.data) : jsonError(result.data);
    }
  );

  server.tool(
    "fetch_book",
    toolDescription("fetch_book"),
    {
      query: appSchemas.searchText.describe("Title, optionally with the author or edition, e.g. \"Algorithmic Trading Chan\"."),
      format: z.string().min(1).optional()
        .describe("Preferred format, e.g. PDF or EPUB. Default: PDF first, then EPUB."),
      output_dir: z.string().min(1).optional()
        .describe("Directory to save into. Default: ~/Downloads/biblio-mcp. Use an absolute path."),
      max_attempts: z.number().int().min(1).max(5).optional()
        .describe("How many copies to try, in order, before giving up (default 3)."),
      sources: appSchemas.sources
        .describe("Which sources to search. Default: the same as search_books."),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async ({ query, format, output_dir, max_attempts, sources }, extra) => {
      const result = await appFetchBook(
        { query, format, output_dir, max_attempts, sources },
        { onProgress: makeProgressReporter(extra), signal: extra?.signal }
      );
      return result.ok ? json(result.data) : jsonError(result.data);
    }
  );

  server.tool(
    "search_papers",
    toolDescription("search_papers"),
    {
      query: appSchemas.searchText.describe("Keywords, title, author, or DOI."),
      limit: appSchemas.limit,
      resolvePdfs: z.boolean().optional()
        .describe("Best-effort direct PDF lookup via Sci-Hub for up to three DOI results; adds network requests."),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ query, limit, resolvePdfs }) => {
      const result = await appSearchPapers({ query, limit, resolvePdfs });
      return json(result.data);
    }
  );

  server.tool(
    "get_paper",
    toolDescription("get_paper"),
    {
      identifier: appSchemas.searchText.describe("DOI (e.g. 10.1038/nature12373), article URL, or title."),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ identifier }) => {
      const result = await appGetPaper({ identifier });
      return json(result.data);
    }
  );

  server.tool(
    "healthcheck",
    toolDescription("healthcheck"),
    {
      timeoutMs: appSchemas.timeoutMs
        .describe("Per-mirror probe timeout in ms (default 8000)."),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ timeoutMs }) => {
      const result = await appHealthcheck({ timeoutMs });
      return json(result.data);
    }
  );

  return server;
}

export { SERVER_NAME, SERVER_VERSION, resolvePaperPdfs };
