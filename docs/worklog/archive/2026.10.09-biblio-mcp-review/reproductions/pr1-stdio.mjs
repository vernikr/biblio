// PR 1 smoke check: real stdio subprocess, SDK responses, no mirror requests.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "../repo/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "../repo/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("../repo/dist/index.js", import.meta.url))],
  stderr: "pipe",
});
let stderr = "";
transport.stderr?.on("data", (chunk) => { stderr += chunk; });
const client = new Client({ name: "pr1-smoke", version: "1.0.0" });
const protocolErrors = [];
client.onerror = (error) => { protocolErrors.push(error.message); };
try {
  await client.connect(transport, { timeout: 5000 });
  const { tools } = await client.listTools({}, { timeout: 5000 });
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    "book_details", "download_book", "get_download_links", "get_paper",
    "healthcheck", "search_books", "search_papers",
  ]);
  const download = tools.find((tool) => tool.name === "download_book");
  assert.match(download.inputSchema.properties.filename.description, /never overwritten/);
  const invalid = await client.callTool({ name: "download_book", arguments: {} }, undefined, { timeout: 5000 });
  assert.equal(invalid.isError, true);
  assert.match(invalid.content[0].text, /md5.*missing.*output_dir.*missing/);
  assert.deepEqual(protocolErrors, [], "stdout must contain only valid MCP frames");
  console.log(JSON.stringify({
    protocolErrors,
    initialized: true,
    tools: tools.map((tool) => tool.name),
    callerFilenameNoOverwriteAdvertised: true,
    invalidCallFlagged: invalid.isError,
    guidance: invalid.content[0].text,
    stderr,
  }, null, 2));
} finally {
  await client.close();
  await transport.close();
}
