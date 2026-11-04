// Exercise actual protocol responses, not strings elsewhere in tools/list.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
test("stdio initializes, lists all tools and returns the expected invalid-call response", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    stderr: "pipe",
    env: { NODE_OPTIONS: process.env.NODE_OPTIONS ?? "" },
  });
  let stderr = "";
  transport.stderr.on("data", (chunk) => { stderr += chunk; });
  const client = new Client({ name: "stdio-test", version: "0.0.0" });
  const errors = [];
  client.onerror = (error) => { errors.push(error.message); };
  try {
    await client.connect(transport, { timeout: 5000 });
    assert.equal(client.getServerVersion().name, "biblio-mcp");
    const { tools } = await client.listTools({}, { timeout: 5000 });
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "book_details", "download_book", "fetch_book", "get_download_links", "get_paper",
      "healthcheck", "search_books", "search_papers",
    ]);
    const result = await client.callTool({
      name: "book_details", arguments: { md5: "not-an-md5" },
    }, undefined, { timeout: 5000 });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /"md5" must be a 32-char MD5 hash/);
    assert.doesNotMatch(result.content[0].text, /_parse is not a function/);
    assert.deepEqual(errors, [], "stdout must contain only valid MCP frames");
    assert.match(stderr, /ready on stdio/);
  } finally {
    await client.close();
    await transport.close();
  }
});
