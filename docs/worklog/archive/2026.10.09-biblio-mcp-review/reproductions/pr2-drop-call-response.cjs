// Mutation-only preload: keep initialize/list output, drop the invalid tool response.
if (process.argv.some((arg) => arg.endsWith('/dist/index.js'))) {
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = function (chunk, encoding, callback) {
    let frame;
    try { frame = JSON.parse(String(chunk)); } catch {}
    if (frame?.result?.isError === true) {
      const done = typeof encoding === 'function' ? encoding : callback;
      if (done) queueMicrotask(() => done());
      return true;
    }
    return write(chunk, encoding, callback);
  };
}
