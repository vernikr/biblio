// One in-memory MCP client per call, torn down afterwards. The caller passes
// the server factory, so importing dist/server.js (and with it the provider
// graph) stays under that test's control: set env first, then import.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

export async function withMcpClient(createServer, fn, clientName = "test") {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: clientName, version: "0.0.0" });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
}
