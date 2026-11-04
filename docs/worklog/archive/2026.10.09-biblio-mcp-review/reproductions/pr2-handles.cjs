setTimeout(() => {
  console.error('HANDLES', process.pid, process._getActiveHandles().map((h) => ({
    type: h.constructor.name, address: typeof h.address === 'function' ? h.address() : null,
    connections: h._connections, remote: h.remoteAddress, port: h.remotePort, destroyed: h.destroyed,
  })));
}, 2000).unref();
setTimeout(() => process.exit(90), 4000).unref();
