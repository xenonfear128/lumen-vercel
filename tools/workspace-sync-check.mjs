import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const root = resolve('.');
const child = join(root, 'workspaces', 'vercel');
// The Vercel sibling workspace is excluded from version control, so a fresh
// clone has no copy to compare against. Skip instead of failing with ENOENT.
try {
  await stat(join(child, 'src'));
} catch {
  console.log('SKIP workspaces/vercel not present; nothing to compare (expected outside the authoring checkout)');
  process.exit(0);
}
async function files(base, dir) {
  const result = [];
  for (const entry of await readdir(join(base, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(base, path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
const mismatches = [];
const dirs = ['src', 'server', 'config'];
for (const dir of dirs) {
  const paths = new Set([...await files(root, dir), ...await files(child, dir)]);
  for (const path of paths) {
    if (path === join('server', 'api-handler.cjs')) continue;
    try {
      if (!(await readFile(join(root, path))).equals(await readFile(join(child, path)))) mismatches.push(path);
    } catch { mismatches.push(path); }
  }
}
assert.deepEqual(mismatches, [], 'Shared source differs between local and Vercel workspaces');
console.log(`PASS shared src/server/config match (${dirs.join(', ')}); Vercel handler remains platform-specific`);
