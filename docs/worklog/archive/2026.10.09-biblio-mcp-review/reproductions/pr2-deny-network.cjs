// Verification-only preload: forbid external fetch/TCP, keep local HTTP fixtures.
const fs = require('node:fs');
const net = require('node:net');
const allowed = (host) => host === 'localhost' || host === '::1' || host === '[::1]' || /^127\./.test(host);
function denied(host) {
  fs.appendFileSync('/home/user/biblio-mcp-review/pr2-blocked-network.log', host + '\n');
  throw new Error('External network forbidden by offline verification: ' + host);
}
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, ...args) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!allowed(url.hostname)) denied(url.hostname);
  return originalFetch(input, ...args);
};
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = typeof first === 'object' ? first : { host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  if (!options.path && !allowed(options.host || 'localhost')) denied(options.host);
  return originalConnect.apply(this, args);
};
