// MCP tool surface.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { access, link as linkFile, mkdir, open, rename, unlink } from "node:fs/promises";
import { join, isAbsolute, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import {
  downloadToFile,
  HtmlInsteadOfFileError,
  resetDeadCache,
  type DownloadProgress,
} from "./http.js";
import { MIRROR_GROUPS, probeGroup, toHealthcheckGroup } from "./mirrors.js";
import { describeArgsError, toolDescription } from "./toolmeta.js";
import { sniffExt } from "./sniff.js";
import { withSourceCircuit } from "./providers/circuit.js";
import {
  searchBooks,
  resolveDownloads,
  bookDetails,
  libgen,
  scihub,
  BOOK_SOURCES,
  ALL_BOOK_SOURCES,
  DISABLED_BOOK_SOURCES,
} from "./providers/index.js";
import type { Paper, SourceId } from "./types.js";

const SERVER_NAME = "biblio-mcp";

/** Read from package.json rather than repeated here. */
const SERVER_VERSION: string = (() => {
  try {
    const pkg = createRequire(import.meta.url)("../package.json") as {
      name?: string;
      version?: string;
    };
    // Reject another project's manifest; an unknown version is safer than a wrong one.
    if (pkg.name !== SERVER_NAME) return "0.0.0-unknown";
    return pkg.version ?? "0.0.0-unknown";
  } catch {
    return "0.0.0-unknown";
  }
})();

const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

/** Same body as `json`, flagged so clients see a failed outcome as a failure. */
const jsonError = (data: unknown) => ({ ...json(data), isError: true });

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

/** Replace zod's raw issue dump with a sentence an agent can act on. */
function validationIssuesFrom(error: unknown): unknown[] | undefined {
  if (!error || typeof error !== "object") return undefined;
  const direct = (error as { issues?: unknown }).issues;
  if (Array.isArray(direct)) return direct;

  // Pinned SDK versions flatten Zod issues into diagnostic text. Translate it
  // without a second schema parse; legacy serialized issues remain supported.
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") return undefined;
  const diagnostic = /Input validation error: Invalid arguments for tool [^:]+: ([\s\S]*)/.exec(message)?.[1];
  if (diagnostic && !diagnostic.startsWith("[")) {
    return diagnostic.split("\n").map((line) => {
      const match = /^(.*) at (.+)$/.exec(line);
      return {
        path: match ? [match[2]] : [],
        message: match?.[1] ?? line,
        code: /expected .*received undefined/.test(line) ? "invalid_type" : "custom",
      };
    });
  }
  const start = message.indexOf("[");
  if (start < 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(message.slice(start));
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function useReadableValidationErrors(server: McpServer): void {
  // The SDK invokes this private method dynamically, so an instance override is enough.
  type ValidatingServer = {
    validateToolInput: (tool: unknown, args: unknown, toolName: string) => Promise<unknown>;
  };
  const target = server as unknown as Partial<ValidatingServer>;
  // Skip the override when this SDK version does not expose the method.
  if (typeof target.validateToolInput !== "function") return;
  const original = target.validateToolInput.bind(server);

  target.validateToolInput = async (tool, args, toolName) => {
    try {
      // Let the SDK perform its one authoritative parse, then translate its
      // structured issue array into the agent-facing sentence.
      return await original(tool, args, toolName);
    } catch (error) {
      const issues = validationIssuesFrom(error);
      if (!issues) throw error;
      const inputSchema =
        tool && typeof tool === "object" ? (tool as { inputSchema?: unknown }).inputSchema : undefined;
      throw new Error(describeArgsError(String(toolName), { issues }, inputSchema));
    }
  };
}

/** A caller-supplied filename is one plain name: no separators, drive
 *  prefixes, NUL bytes, or the `.`/`..` entries that climb out of the directory. */
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
        .array(z.enum(["annas", "libgen", "zlibrary"]))
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
    async ({ query, sources, limit }) => {
      const selectedSources = [...new Set((sources as SourceId[]) ?? BOOK_SOURCES)];
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
    async ({ md5 }) => {
      const links = await resolveDownloads(md5.toLowerCase());
      return json({ md5: md5.toLowerCase(), count: links.length, links });
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
        .describe(
          "Directory to save into; created if missing. Use an absolute path. " +
            "A relative path is resolved against $HOME (not the server's working " +
            "directory, which you cannot see), and the resolved directory is " +
            "reported back as `outputDir`."
        ),
      filename: z
        .string()
        .optional()
        .describe("Optional plain filename; defaults to <md5>.<ext>. Existing names are never overwritten."),
    },
    async ({ md5, output_dir, filename }, extra) => {
      const hash = md5.toLowerCase();
      // Validate before any network work: a bad name must never reach the disk.
      const plainName = filename === undefined ? undefined : plainFileName(filename);
      const links = await resolveDownloads(hash);
      const direct = links.filter((l) => l.direct);
      if (direct.length === 0)
        return jsonError({
          saved: false,
          reason: "No direct download link resolved. Use these links manually.",
          links,
        });

      // Resolve relative output paths from $HOME, a predictable location for both sides.
      const wasRelative = !isAbsolute(output_dir);
      const dir = wasRelative ? resolve(homedir(), output_dir) : output_dir;
      await mkdir(dir, { recursive: true });

      // A file the caller named is theirs: refuse rather than overwrite it.
      if (plainName !== undefined) {
        const taken = await access(join(dir, plainName)).then(() => true, () => false);
        if (taken) {
          return jsonError({
            saved: false,
            reason: `${plainName} already exists in ${dir}; choose another filename.`,
          });
        }
      }

      const onProgress = makeProgressReporter(extra);
      // A staging name unique to this call, so concurrent downloads of the same
      // md5 into the same directory cannot write or delete each other's bytes.
      const staging = join(dir, `${hash}.${randomUUID()}.downloading`);
      const errors: string[] = [];

      for (const link of direct) {
        try {
          const result = await downloadToFile(link.url, staging, {
            onProgress,
            signal: extra?.signal,
          });

          const name =
            plainName ??
            `${hash}.${sniffExt(await readFileHead(staging, 4096), result.contentType)}`;
          const path = join(dir, name);
          try {
            // A precheck cannot prevent a concurrent writer. link is atomic and
            // refuses an existing caller-chosen name; never fall back to rename.
            if (plainName !== undefined) await linkFile(staging, path);
            else await rename(staging, path);
          } catch (e) {
            await unlink(staging).catch(() => {});
            // Publication is a local failure, not a reason to try another URL.
            return jsonError({
              saved: false,
              reason: (e as NodeJS.ErrnoException).code === "EEXIST"
                ? `${name} already exists in ${dir}; choose another filename.`
                : `Cannot publish ${name} in ${dir}: ${(e as Error).message}`,
            });
          }
          if (plainName !== undefined) await unlink(staging).catch(() => {});

          return json({
            saved: true,
            path,
            /** Absolute directory the file landed in — always resolved, so a
             *  relative `output_dir` never leaves the caller guessing. */
            outputDir: dir,
            ...(wasRelative
              ? { note: `"${output_dir}" was relative; resolved to ${dir}. Pass an absolute path to avoid surprises.` }
              : {}),
            bytes: result.bytes,
            via: link.label,
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
          });
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
      return jsonError({ saved: false, errors, links });
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

export { SERVER_NAME, SERVER_VERSION, ALL_BOOK_SOURCES };
