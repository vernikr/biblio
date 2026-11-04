// Agent-facing tool metadata: what each tool does, one call example, and
// human-readable argument errors. Argument descriptions stay in the Zod schemas.

export interface ToolMeta {
  /** What the tool does; shown to agents with the example appended. */
  description: string;
  /** One call, checked against the tool's schema by test/tool-meta.test.mjs. */
  example: string;
}

export const TOOL_META: Record<string, ToolMeta> = {
  search_books: {
    description: "Search for books/documents across Anna's Archive, Library Genesis, and Z-Library at once. Results are merged and de-duplicated by MD5 hash. Results include an `md5` when the source provides one; pass it to get_download_links or download_book. Per-source failures are reported in `errors` without failing the call.",
    example: "{\"query\":\"dune frank herbert\",\"limit\":5}",
  },
  book_details: {
    description: "Get full metadata and download options for a single book by its MD5 hash (from a search_books result). Queries Anna's Archive and Library Genesis in parallel and returns the first usable result; Libgen metadata comes from a structured BibTeX block. The response says which source answered in `resolvedVia`, and a concise `annasUnavailable` reason when Anna's Archive did not answer first.",
    example: "{\"md5\":\"524037f395462d37b31f2b28fede24fb\"}",
  },
  get_download_links: {
    description: "Resolve every available download link for a book by MD5 — Libgen direct (get.php), Anna's Archive partners, and IPFS gateways. Links marked `direct: true` point straight at the file.",
    example: "{\"md5\":\"524037f395462d37b31f2b28fede24fb\"}",
  },
  download_book: {
    description: "Download a book file to a local directory by MD5. Streams direct links (Libgen/IPFS) to disk in order and keeps the first that yields a real file, so peak memory does not scale with book size. Returns the saved path, byte count, and the MD5 of what was written. Check `md5MatchesRequest`; a mismatch includes an explicit warning. If nothing saves, `alternatives` lists other copies of the same title: call download_book again with one of their md5 values, do not use curl. To pick copies automatically, use fetch_book.",
    example: JSON.stringify({ md5: "524037f395462d37b31f2b28fede24fb" }),
  },
  fetch_book: {
    description: "Get a book by title in one call: search, rank the copies (requested format, then PDF, then the largest), try up to `max_attempts` of them in order, and save the first that yields a verified file. Returns `path`, `picked` (the title, author and md5 that was saved) and `attempts`. Start here when you have a title, not an MD5. If it fails, `attempts` says why each copy failed and `nextStep` says what to do.",
    example: JSON.stringify({ query: "Algorithmic Trading Ernest Chan", format: "PDF" }),
  },
  search_papers: {
    description: "Search academic papers / journal articles by keyword, author, title, or DOI via Library Genesis scimag. Returns DOIs and mirror links. Set `resolvePdfs: true` to best-effort resolve direct PDF URLs via Sci-Hub for up to three results (extra network requests; off by default).",
    example: "{\"query\":\"attention is all you need\",\"limit\":5}",
  },
  get_paper: {
    description: "Resolve a paper's PDF via Sci-Hub. Accepts a DOI (best), an article URL, or a title. Returns metadata and a direct `pdfUrl` when available.",
    example: "{\"identifier\":\"10.48550/arXiv.1706.03762\"}",
  },
  healthcheck: {
    description: "Report whether this server can reach its sources, with per-mirror latency. Probes host roots only — it never queries a catalogue, so it is cheap and safe to call before a search. Use it to tell 'the network is blocked' apart from 'the query matched nothing'. A mirror that answers but is not the site it claims to be is reported as `impostor`, not as healthy.",
    example: "{}",
  },
};

/** The one list of tool names. `selfcheck` and the tool-surface tests read it, so a
 *  renamed or added tool cannot leave a second copy behind. */
export const TOOL_NAMES: readonly string[] = Object.keys(TOOL_META);

/** The full description an agent sees: what the tool does, then one example call. */
export function toolDescription(name: string): string {
  const meta = TOOL_META[name];
  if (!meta) throw new Error(`no TOOL_META entry for ${name}`);
  return `${meta.description}\n\nExample: ${meta.example}`;
}

/** Minimal shape of a zod issue, read defensively: the parser is whichever zod
 *  build the SDK ships, and a v3 one formats its issues differently. */
interface Issue {
  path?: Array<string | number>;
  code?: string;
  message?: string;
}

/** The issues `args` raise against a tool's own schema — undefined when the
 *  schema carries no parser (older SDK) or the call is valid. */
function issuesOf(schema: unknown, args: unknown): Issue[] | undefined {
  const safeParse = (schema as { safeParse?: (value: unknown) => unknown } | undefined)?.safeParse;
  if (typeof safeParse !== "function") return undefined;
  const result = safeParse.call(schema, args ?? {}) as
    | { success?: boolean; error?: { issues?: Issue[] } }
    | undefined;
  return result?.success ? undefined : result?.error?.issues;
}

/** Minimal Zod object-field shape needed for agent-facing requirements. */
interface InputFieldSchema {
  description?: string;
  isOptional?: () => boolean;
}

function requirementsFromSchema(schema: unknown): string | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  const shape = (schema as { shape?: Record<string, InputFieldSchema> }).shape;
  if (!shape) return undefined;

  const fields = Object.entries(shape);
  if (fields.length === 0) return "no arguments";
  const label = ([name, field]: [string, InputFieldSchema]) => {
    const description = typeof field.description === "string" ? field.description.trim() : "";
    return `"${name}"${description ? ` — ${description.replace(/[.!?]+$/, "")}` : ""}`;
  };
  const required = fields.filter(([, field]) => !field.isOptional?.());
  const optional = fields.filter(([, field]) => field.isOptional?.());
  return [
    required.length ? `required: ${required.map(label).join(", ")}` : "no required arguments",
    optional.length ? `optional: ${optional.map(label).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/** `["sources", 0]` -> `sources[0]`: the path an agent can find in its own call. */
function fieldPath(path: Array<string | number>): string {
  return path.reduce<string>(
    (acc, segment) =>
      typeof segment === "number" ? `${acc}[${segment}]` : acc ? `${acc}.${segment}` : segment,
    ""
  );
}

/** The sentence an agent reads when its arguments do not fit the tool's schema;
 *  undefined when the schema accepted them or cannot be asked. */
export function describeArgsError(name: string, args: unknown, schema?: unknown): string | undefined {
  const issues = issuesOf(schema, args);
  if (!issues || issues.length === 0) return undefined;

  const problems = issues.map((issue) => {
    const field = issue.path && issue.path.length > 0 ? fieldPath(issue.path) : "arguments";
    const raw = issue.message ?? "is invalid";
    const message = raw.charAt(0).toLowerCase() + raw.slice(1);
    const missing = issue.code === "invalid_type" && /undefined/.test(message);
    return missing ? `"${field}" is missing` : `"${field}" ${message}`;
  });

  const meta = TOOL_META[name];
  const requirements = requirementsFromSchema(schema);
  return [
    `${name}: ${problems.join("; ")}.`,
    requirements ? `Schema: ${requirements}.` : "",
    meta ? `Example: ${meta.example}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
