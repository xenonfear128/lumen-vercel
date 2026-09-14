const { join } = require('node:path');
const { mkdirSync } = require('node:fs');
const defaults = require('../config/local-services.json').neteaseApi;
const host = process.env.LUMEN_HOST || defaults.host;
const port = Number(process.env.LUMEN_PORT || defaults.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid LUMEN_PORT');
if (process.env.LUMEN_DATA_DIR) {
  const temp = join(process.env.LUMEN_DATA_DIR, 'api-cache');
  mkdirSync(temp, { recursive: true, mode: 0o700 });
  process.env.TMPDIR = process.env.TMP = process.env.TEMP = temp;
}
const { createLumenServer } = require('./service.cjs');
const server = createLumenServer({
  authUser: process.env.LUMEN_AUTH_USER || '',
  authPassword: process.env.LUMEN_AUTH_PASSWORD || '',
  desktopToken: process.env.LUMEN_DESKTOP_TOKEN || '',
});
const notify = message => process.parentPort?.postMessage(message);
server.on('error', error => {
  const code = error.code || 'START_FAILED';
  notify({ type: 'error', code });
  console.error(`Lumen service could not start (${code}).`);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  notify({ type: 'ready', port });
  console.log(`Lumen listening at http://${host}:${port}`);
});
let closing = false;
function shutdown() {
  if (closing) return; closing = true;
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.parentPort?.on('message', event => { if (event.data?.type === 'shutdown') shutdown(); });
