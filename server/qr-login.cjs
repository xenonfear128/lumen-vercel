// Use the SDK request primitive directly: its QR module loses the original error
// through a catch-scope bug. Never turn a transport failure into a QR state.
async function checkQrLogin(query, request, createOption) {
  let result;
  try {
    result = await request('/api/login/qrcode/client/login', { key: query.key, type: 3 }, createOption(query));
  } catch (error) {
    if (![800, 801, 802, 803].includes(error?.body?.code)) throw error;
    result = error;
  }
  const code = result?.body?.code;
  if (![800, 801, 802, 803].includes(code)) throw new Error('Invalid QR response');
  const cookie = Array.isArray(result.cookie)
    ? result.cookie.filter(value => typeof value === 'string').join(';')
    : typeof result.body.cookie === 'string' ? result.body.cookie : '';
  if (code === 803 && !cookie.trim()) throw new Error('Missing login credential');
  return { status: 200, body: { code, cookie }, cookie: [] };
}
module.exports = { checkQrLogin };
