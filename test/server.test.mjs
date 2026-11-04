// Tests for the MCP tool surface, driven over an in-memory transport.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../dist/server.js";
import { TOOL_NAMES as REQUIRED_TOOLS } from "../dist/toolmeta.js";
import { withMcpClient } from "./helpers/mcp.mjs";

async function withClient(fn) {
  return withMcpClient(createServer, async (client) => {
    return await fn(client);
  }, "test");
}

test("the server exposes exactly the documented tool set", async () => {
  await withClient(async (client) => {
    const info = await client.getServerVersion();
    assert.equal(info.name, "biblio-mcp");

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [...REQUIRED_TOOLS].sort());
  });
});

test("every tool advertises an input schema with its required fields", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      assert.ok(tool.inputSchema, `${tool.name} must publish an inputSchema`);
      // Empty required lists are valid; tools needing arguments must declare them.
      const required = tool.inputSchema.required;
      assert.ok(
        required === undefined || Array.isArray(required),
        `${tool.name} must publish "required" as an array when present`
      );
      if (tool.name !== "healthcheck") {
        assert.ok(
          Array.isArray(required) && required.length > 0,
          `${tool.name} must declare at least one required argument`
        );
      }
      assert.ok(tool.description && tool.description.length > 20, `${tool.name} needs a description`);
    }
  });
});

test("search_papers advertises opt-in PDF resolution without making it required", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const search = tools.find((tool) => tool.name === "search_papers");
    assert.equal(search.inputSchema.properties.resolvePdfs.type, "boolean");
    assert.ok(!search.inputSchema.required.includes("resolvePdfs"));
    assert.match(search.description, /resolve direct PDF URLs via Sci-Hub/);
  });
});

test("download_book requires only md5; output_dir has a default", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const dl = tools.find((t) => t.name === "download_book");
    assert.deepEqual([...dl.inputSchema.required].sort(), ["md5"]);
  });
});

test("argument validation names the field an agent got wrong", async () => {
  // Validation errors must name fields so an agent can correct its call.
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "download_book",
      arguments: { md5: "not-a-hash" },
    });
    assert.equal(result.isError, true);
    const text = String(result.content?.[0]?.text ?? "");
    assert.match(text, /md5/);
  });
});

test("search_books documents which sources are searched by default", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const sb = tools.find((t) => t.name === "search_books");
    const sourcesDesc = sb.inputSchema.properties.sources.description;
    assert.match(sourcesDesc, /annas/);
    assert.match(sourcesDesc, /libgen/);
    // The description must stay truthful about zlibrary being off by default,
    // otherwise an agent will assume three sources answered and got nothing.
    assert.match(sourcesDesc, /zlibrary/);
  });
});

test("search_books advertises that an explicit source list must be non-empty", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const sb = tools.find((t) => t.name === "search_books");
    assert.equal(sb.inputSchema.properties.sources.minItems, 1);
  });
});

test("one source list reaches the client, the defaults and the providers", async () => {
  // The caller-facing enum, the default selection and the provider registry are
  // one list: adding a source must not leave a second copy to update.
  const { BOOK_SOURCE_IDS } = await import("../dist/types.js");
  const { ALL_BOOK_SOURCES } = await import("../dist/providers/index.js");
  assert.deepEqual(ALL_BOOK_SOURCES, [...BOOK_SOURCE_IDS]);
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    for (const name of ["search_books", "fetch_book"]) {
      const schema = tools.find((t) => t.name === name).inputSchema;
      assert.deepEqual(schema.properties.sources.items.enum, [...BOOK_SOURCE_IDS], name);
    }
  });
});

test("the reported version matches package.json", async () => {
  // SERVER_VERSION used to be a hardcoded string, so bumping the version left
  // `--version` and `--selfcheck` advertising the previous release.
  const { readRootPackage } = await import("../scripts/lib/pkg.mjs");
  const pkg = readRootPackage();

  await withClient(async (client) => {
    const info = await client.getServerVersion();
    assert.equal(info.name, "biblio-mcp");
    assert.equal(info.version, pkg.version);
  });
});

test("download_book and fetch_book take their output directory optionally, so a bare title is enough", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    assert.deepEqual(byName.download_book.inputSchema.required, ["md5"]);
    assert.deepEqual(byName.fetch_book.inputSchema.required, ["query"]);
    assert.ok(byName.fetch_book.inputSchema.properties.output_dir, "fetch_book keeps output_dir as an option");
  });
});
