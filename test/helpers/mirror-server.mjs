// Shared start/stop helpers for the local HTTP servers that stand in for mirrors.

/** Listen on a free loopback port and return the origin, e.g. http://127.0.0.1:41234. */
export function listenLocal(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

/**
 * Close a test server. Keep-alive sockets from the client are dropped first;
 * otherwise close() waits for them to time out and the suite sits idle.
 */
export function closeServer(server) {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}
