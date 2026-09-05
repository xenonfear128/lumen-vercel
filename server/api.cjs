const { mkdirSync, existsSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { randomBytes } = require('node:crypto');

// Only the operations used by Lumen are exposed. Never forward client-supplied
// proxy/domain/header options into the upstream SDK.
const ROUTES = Object.freeze({
  '/cloudsearch': ['cloudsearch', ['keywords', 'limit', 'offset', 'type']],
  '/song/url/v1': ['song_url_v1', ['id', 'level']],
  '/playlist/detail': ['playlist_detail', ['id']],
  '/song/detail': ['song_detail', ['ids']],
  '/user/playlist': ['user_playlist', ['uid', 'limit', 'offset']],
  '/login/qr/key': ['login_qr_key', []],
  '/login/qr/create': ['login_qr_create', ['key', 'qrimg']],
  '/login/qr/check': ['login_qr_check', ['key']],
  '/login/status': ['login_status', []],
  '/logout': ['logout', []],
});

function createApi() {
  const temporary = tmpdir();
  mkdirSync(temporary, { recursive: true, mode: 0o700 });
  const tokenPath = join(temporary, 'anonymous_token');
  if (!existsSync(tokenPath)) writeFileSync(tokenPath, '', { mode: 0o600 });
  global.deviceId ||= randomBytes(16).toString('hex');
  const { cookieToJson } = require('@neteasecloudmusicapienhanced/api/util');
  const request = require('@neteasecloudmusicapienhanced/api/util/request');
  const modules = new Map(Object.values(ROUTES).map(([name]) => [name,
    require(`@neteasecloudmusicapienhanced/api/module/${name}.js`)]));
  return async (pathname, parameters) => {
    const route = ROUTES[pathname];
    if (!route) return { status: 404, body: { code: 404, msg: 'Unknown endpoint' } };
    const query = { cookie: cookieToJson(parameters.cookie || ''), timeout: 15000 };
    for (const key of route[1]) if (typeof parameters[key] === 'string') query[key] = parameters[key];
    try {
      return await modules.get(route[0])(query, request);
    } catch (error) {
      // SDK failures may include request credentials; do not log or serialize them.
      return { status: 502, body: { code: 502, msg: 'Music service is temporarily unavailable' } };
    }
  };
}
module.exports = { createApi, ROUTES };
