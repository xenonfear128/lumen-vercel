const { randomBytes, createHash, timingSafeEqual, scrypt, createCipheriv, createDecipheriv } = require('node:crypto');
const { promisify } = require('node:util');
const derive = promisify(scrypt);
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const equal = (a, b) => timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
function fail(code, status = 400) { throw Object.assign(new Error(code), { code, status }); }
async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) fail('PASSWORD_INVALID');
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt:${salt}:${key.toString('hex')}`;
}
async function checkPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [, salt, expected] = (stored || '').split(':');
  if (!salt || !expected) return false;
  const key = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return equal(key.toString('hex'), expected);
}
function encryptionKey(value) {
  const key = Buffer.from(value || '', 'base64');
  if (key.length !== 32) fail('SOURCE_KEY_MISSING', 503);
  return key;
}
function encrypt(value, secret) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), value: ciphertext.toString('base64') };
}
function decrypt(value, secret) {
  const cipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), Buffer.from(value.iv, 'base64'));
  cipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([cipher.update(Buffer.from(value.value, 'base64')), cipher.final()]).toString('utf8');
}
module.exports = { hash, token, equal, fail, passwordHash, checkPassword, encrypt, decrypt, encryptionKey };
