const { writeFile } = require('node:fs/promises');
const { join } = require('node:path');

// The upstream song URL endpoint requires a public encryption key that its
// standalone server normally initializes. A fresh serverless /tmp has no key.
function createXeapiInitializer({ directory, deviceId, timeoutMs = 8000,
  fetchKey = () => require('@neteasecloudmusicapienhanced/api/util/xeapiKey').getXeapiPublicKey({}, deviceId),
}) {
  let pending;
  return () => {
    if (!pending) {
      pending = (async () => {
        let timer;
        try {
          const key = await Promise.race([
            Promise.resolve().then(fetchKey),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Public key initialization timed out')), timeoutMs); }),
          ]);
          if (!key || typeof key.sk !== 'string' || !key.sk) throw new Error('Invalid public key response');
          await writeFile(join(directory, 'xeapi_public_key'), JSON.stringify(key), { mode: 0o600 });
        } finally { clearTimeout(timer); }
      })().catch(error => { pending = undefined; throw error; });
    }
    return pending;
  };
}

module.exports = { createXeapiInitializer };
