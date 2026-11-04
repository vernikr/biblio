// Each tool's description and example live in one place (src/toolmeta.ts).
// These tests keep that place honest: every served tool has an entry, no entry
// is stale, and every example is a valid call under the tool's own schema.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../dist/server.js";
import { TOOL_META, toolDescription } from "../dist/toolmeta.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { withMcpClient } from "./helpers/mcp.mjs";

const validator = new AjvJsonSchemaValidator();

async function listTools() {
  return withMcpClient(createServer, async (client) => {
    return (await client.listTools()).tools;
  }, "test");
}

const tools = await listTools();
const served = new Set(tools.map((t) => t.name));

test("every served tool has a TOOL_META entry, and no entry is stale", () => {
  assert.deepEqual(
    [...served].filter((name) => !(name in TOOL_META)),
    [],
    "served tools missing from TOOL_META"
  );
  assert.deepEqual(
    Object.keys(TOOL_META).filter((name) => !served.has(name)),
    [],
    "TOOL_META entries for tools that are not served"
  );
});

test("the served description is exactly the one src/toolmeta.ts defines", () => {
  for (const tool of tools) {
    assert.equal(tool.description, toolDescription(tool.name), `${tool.name} description drifted`);
    assert.ok(tool.description.includes("\n\nExample: "), `${tool.name} must end with an example`);
  }
});

test("every example is a valid call under its tool's input schema (checked by the SDK's AJV validator)", () => {
  for (const tool of tools) {
    const args = JSON.parse(TOOL_META[tool.name].example);
    const schema = tool.inputSchema ?? {};
    const properties = schema.properties ?? {};

    for (const key of Object.keys(args)) {
      assert.ok(key in properties, `${tool.name} example uses unknown argument "${key}"`);
    }
    const check = validator.getValidator(schema)(args);
    assert.equal(check.valid, true, `${tool.name} example is not valid: ${check.errorMessage}`);
  }
});

test("the schema validator rejects bad values, so the example check means something", () => {
  const searchSchema = tools.find((t) => t.name === "search_books").inputSchema;
  const search = validator.getValidator(searchSchema);
  assert.equal(search({ query: "dune", limit: 1000 }).valid, false, "limit above its maximum");
  assert.equal(search({ query: "dune", limit: 2.5 }).valid, false, "limit must be an integer");
  assert.equal(search({ query: "dune", sources: ["nope"] }).valid, false, "unknown source enum");

  const papersSchema = tools.find((t) => t.name === "search_papers").inputSchema;
  assert.equal(
    validator.getValidator(papersSchema)({ query: "x", resolvePdfs: "yes" }).valid,
    false,
    "resolvePdfs is a boolean"
  );
});

test("tool annotations state what each tool does to the outside world", () => {
  const annotations = Object.fromEntries(tools.map((t) => [t.name, t.annotations ?? {}]));
  // Lookups that only read catalogues or probe mirrors are read-only.
  for (const name of ["search_books", "book_details", "search_papers", "get_paper", "healthcheck"]) {
    assert.equal(annotations[name].readOnlyHint, true, `${name} should be read-only`);
  }
  // Member-link resolution may spend quota, so it must not claim to be read-only.
  assert.notEqual(annotations.get_download_links.readOnlyHint, true);
  // download_book writes a new file: not read-only, and never idempotent.
  assert.equal(annotations.download_book.readOnlyHint, false);
  assert.equal(annotations.download_book.idempotentHint, false);
  // fetch_book also writes a file, so the same contract holds.
  assert.equal(annotations.fetch_book.readOnlyHint, false);
  assert.equal(annotations.fetch_book.idempotentHint, false);
  // Every tool talks to third-party sites, so each one is open-world.
  for (const tool of tools) assert.equal(annotations[tool.name].openWorldHint, true, `${tool.name} openWorldHint`);
});
