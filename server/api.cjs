const { mkdirSync, existsSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { randomBytes } = require('node:crypto');
const { createXeapiInitializer } = require('./xeapi-key.cjs');

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

// Resolve only at runtime: file tracers must not package the build machine's
// temporary directory (which can contain unrelated files and credentials).
function runtimeTemporaryDirectory() { return tmpdir(); }

function createApi() {
  const temporary = runtimeTemporaryDirectory();
  mkdirSync(temporary, { recursive: true, mode: 0o700 });
  const tokenPath = join(temporary, 'anonymous_token');
  if (!existsSync(tokenPath)) {
    try { writeFileSync(tokenPath, '', { mode: 0o600, flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  global.deviceId ||= randomBytes(16).toString('hex');
  const ensureXeapiKey = createXeapiInitializer({ directory: temporary, deviceId: global.deviceId });
  const { cookieToJson } = require('@neteasecloudmusicapienhanced/api/util');
  const request = require('@neteasecloudmusicapienhanced/api/util/request');
  const { checkQrLogin } = require('./qr-login.cjs');
  const createOption = require('@neteasecloudmusicapienhanced/api/util/option.js');
  const modules = new Map(Object.entries({
    cloudsearch: require('@neteasecloudmusicapienhanced/api/module/cloudsearch.js'),
    song_url_v1: require('@neteasecloudmusicapienhanced/api/module/song_url_v1.js'),
    playlist_detail: require('@neteasecloudmusicapienhanced/api/module/playlist_detail.js'),
    song_detail: require('@neteasecloudmusicapienhanced/api/module/song_detail.js'),
    user_playlist: require('@neteasecloudmusicapienhanced/api/module/user_playlist.js'),
    login_qr_key: require('@neteasecloudmusicapienhanced/api/module/login_qr_key.js'),
    login_qr_create: require('@neteasecloudmusicapienhanced/api/module/login_qr_create.js'),
    login_qr_check: (query, request) => checkQrLogin(query, request, createOption),
    login_status: require('@neteasecloudmusicapienhanced/api/module/login_status.js'),
    logout: require('@neteasecloudmusicapienhanced/api/module/logout.js'),
  }));
  return async (pathname, parameters) => {
    const route = Object.hasOwn(ROUTES, pathname) ? ROUTES[pathname] : undefined;
    if (!route) return { status: 404, body: { code: 404, msg: 'Unknown endpoint' } };
    const query = { cookie: cookieToJson(parameters.cookie || ''), timeout: 15000 };
    for (const key of route[1]) if (typeof parameters[key] === 'string') query[key] = parameters[key];
    try {
      if (pathname === '/song/url/v1') await ensureXeapiKey();
      return await modules.get(route[0])(query, request);
    } catch (error) {
      // SDK failures may include request credentials; do not log or serialize them.
      return { status: 502, body: { code: 502, msg: 'Music service is temporarily unavailable' } };
    }
  };
}
module.exports = { createApi, ROUTES };
