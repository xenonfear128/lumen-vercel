const { app, BrowserWindow, dialog, Menu, utilityProcess, session, screen } = require('electron');
const { join } = require('node:path');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { randomBytes } = require('node:crypto');
const { neteaseApi } = require('../config/local-services.json');
const origin = `http://${neteaseApi.host}:${neteaseApi.port}`;
const token = randomBytes(32).toString('hex');
let window, backend, stopping = false;
// Test runner supplies an isolated profile; normal builds use the OS app-data directory.
if (process.env.LUMEN_TEST_USER_DATA) app.setPath('userData', process.env.LUMEN_TEST_USER_DATA);
app.setAppUserModelId('app.lumen.player');
if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { stopping = true; backend?.kill(); });
  app.whenReady().then(start).catch(error => {
    console.error('Lumen startup failed:', error.code || error.message);
    if (!process.env.LUMEN_TEST_HEADLESS) dialog.showErrorBox('Lumen 启动失败 / Startup failed', error.code === 'EADDRINUSE'
      ? `端口 ${neteaseApi.port} 已被其他程序占用。请关闭占用程序后重试。\nPort ${neteaseApi.port} is already in use.`
      : '音乐服务未能启动，请重新打开 Lumen。\nThe music service could not start. Please reopen Lumen.');
    app.quit();
  });
}
async function start() {
  Menu.setApplicationMenu(null);
  const userData = app.getPath('userData');
  mkdirSync(userData, { recursive: true });
  const stateFile = join(userData, 'window.json');
  let saved = {};
  try { saved = JSON.parse(readFileSync(stateFile, 'utf8')); } catch {}
  const area = screen.getPrimaryDisplay().workAreaSize;
  // Prevent a moved/disconnected monitor or corrupt saved state from hiding the window.
  const width = Math.min(area.width, Math.max(800, Number(saved.width) || 1440));
  const height = Math.min(area.height, Math.max(560, Number(saved.height) || 900));
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, callback) => {
    details.requestHeaders['X-Lumen-Desktop'] = token;
    callback({ requestHeaders: details.requestHeaders });
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { backend.kill(); reject(new Error('Startup timeout')); }, 25000);
    backend = utilityProcess.fork(join(__dirname, '..', 'server', 'start.cjs'), [], {
      serviceName: 'Lumen Music Service',
      env: { ...process.env, LUMEN_HOST: neteaseApi.host, LUMEN_PORT: String(neteaseApi.port),
        LUMEN_DESKTOP_TOKEN: token, LUMEN_DATA_DIR: userData, LUMEN_AUTH_USER: '', LUMEN_AUTH_PASSWORD: '' },
      stdio: 'pipe',
    });
    if (process.env.LUMEN_TEST_HEADLESS) backend.stderr?.on('data', data => console.error('API startup:', data.toString()));
    backend.on('message', message => {
      if (message.type === 'ready') { clearTimeout(timer); resolve(); }
      if (message.type === 'error') { clearTimeout(timer); reject(Object.assign(new Error(message.code), { code: message.code })); }
    });
    backend.on('exit', () => {
      clearTimeout(timer);
      if (!window) reject(new Error('Music service exited'));
      else if (!stopping) {
        if (!process.env.LUMEN_TEST_HEADLESS) dialog.showErrorBox('Lumen', '音乐服务已停止，请重新打开应用。\nThe music service stopped. Please reopen Lumen.');
        app.quit();
      }
    });
  });
  window = new BrowserWindow({
    width, height, minWidth: 800, minHeight: 560, show: false,
    title: 'Lumen', backgroundColor: '#121211', icon: join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
  window.on('close', () => {
    try { writeFileSync(stateFile, JSON.stringify({ ...window.getNormalBounds(), maximized: window.isMaximized() })); } catch {}
  });
  window.once('ready-to-show', () => { if (saved.maximized) window.maximize(); if (!process.env.LUMEN_TEST_HEADLESS) window.show(); });
  await window.loadURL(origin);
}
