const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdir, mkdtemp, readFile } = require('node:fs/promises');
const { resolve, join } = require('node:path');
const { createXeapiInitializer } = require('../server/xeapi-key.cjs');

async function freshDirectory() {
  await mkdir(resolve('test-results'), { recursive: true });
  return mkdtemp(resolve('test-results/xeapi-key-'));
}
test('a fresh runtime fetches and writes the SDK public key once for concurrent requests', async () => {
  const directory = await freshDirectory();
  let requests = 0;
  const key = { sk: 'fixture-public-key', version: 'fixture-version' };
  const ensure = createXeapiInitializer({ directory, fetchKey: async () => { requests++; return key; } });
  await Promise.all([ensure(), ensure(), ensure()]);
  await ensure();
  assert.equal(requests, 1);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'xeapi_public_key'), 'utf8')), key);
});
test('invalid or failed key registration does not poison the warm instance', async () => {
  const directory = await freshDirectory();
  let attempts = 0;
  const ensure = createXeapiInitializer({ directory, fetchKey: async () => ++attempts === 1 ? {} : { sk: 'valid-public-key' } });
  await assert.rejects(ensure(), /Invalid public key/);
  await ensure();
  assert.equal(attempts, 2);
});
test('unresponsive key registration respects its budget and allows a later retry', async () => {
  const directory = await freshDirectory();
  let attempts = 0;
  const ensure = createXeapiInitializer({ directory, timeoutMs: 15, fetchKey: () => ++attempts === 1 ? new Promise(() => {}) : { sk: 'recovered-public-key' } });
  await assert.rejects(ensure(), /timed out/);
  await ensure();
  assert.equal(attempts, 2);
});
