// Progress notifications are best-effort; a disconnected MCP client must not
// leak an unhandled rejection into the download stream.

import test from "node:test";
import assert from "node:assert/strict";
import { makeProgressReporter } from "../dist/server.js";

test("makeProgressReporter swallows a rejected progress notification", async () => {
  const report = makeProgressReporter({
    _meta: { progressToken: "test-token" },
    sendNotification: async () => {
      throw new Error("client disconnected");
    },
  });

  await assert.doesNotReject(() => report({ bytes: 1024, total: 4096 }));
});
