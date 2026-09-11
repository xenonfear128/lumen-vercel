const test = require('node:test');
const assert = require('node:assert/strict');
const { checkQrLogin } = require('../server/qr-login.cjs');
const option = query => ({ cookie: query.cookie });

test('QR adapter preserves every legitimate state and credentials from the request primitive', async () => {
  for (const code of [800, 801, 802, 803]) {
    const result = await checkQrLogin({ key: 'fixture', cookie: {} }, async (path, data) => {
      assert.equal(path, '/api/login/qrcode/client/login');
      assert.deepEqual(data, { key: 'fixture', type: 3 });
      return { body: { code }, cookie: code === 803 ? ['MUSIC_U=fixture'] : [] };
    }, option);
    assert.equal(result.body.code, code);
    assert.equal(result.body.cookie, code === 803 ? 'MUSIC_U=fixture' : '');
  }
});

test('QR adapter propagates transport failures and malformed success, never fabricates waiting', async () => {
  for (const response of [{ body: { code: 502 } }, { body: {} }, { body: { code: 803 }, cookie: [] }]) {
    await assert.rejects(checkQrLogin({}, async () => response, option));
  }
  const failure = new Error('fixture');
  await assert.rejects(checkQrLogin({}, async () => { throw failure; }, option), error => error === failure);
});

test('QR adapter handles rejected QR envelopes without losing the successful credential', async () => {
  const result = await checkQrLogin({}, async () => { throw { body: { code: 803 }, cookie: ['MUSIC_U=fixture'] }; }, option);
  assert.deepEqual(result.body, { code: 803, cookie: 'MUSIC_U=fixture' });
});
