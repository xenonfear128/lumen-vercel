# Lumen

本地与在线音乐播放器，提供 Linux 自部署和 Vercel 网页版。React 19、TypeScript、Vite，内置网易云 API Enhanced。桌面代码保留，但当前暂停开发和自动打包。

## 网站账号与公共音源

- 管理员在 `/admin` 使用部署初始化口令创建账号，扫码绑定一个公共网易云音源账号。
- 用户通过邀请码、用户名和密码注册；邀请码单次使用，7 天有效。
- 访客可搜索和本地播放；在线播放只使用管理员音源，必须登录 Lumen，不回退个人账号。
- 个人网易云登录仅用于读取自己的歌单；公共账号的凭据不返回浏览器、不写入开源代码。
- 歌单与收听统计跨设备同步；本地文件留在浏览器 IndexedDB。其他设备显示“此设备无文件”，可以手动选择文件关联。
- 首次登录会询问是否导入访客数据。主题、音量、均衡器和当前播放选择仍是设备设置。

## Linux 启动

需要 Docker Engine 和 Compose v2。执行：

```sh
sh deploy/linux.sh start
```

首次启动创建 `.env` 并生成部署专属的数据库密码、凭据加密密钥和初始化口令。Compose 启动 PostgreSQL，独立迁移容器完成迁移后再启动网站。

默认监听宿主机 `127.0.0.1:8080`。通过 Caddy 或其他反向代理提供 HTTPS 后，打开 `/admin`，使用 `.env` 的 `LUMEN_SETUP_TOKEN` 创建首个管理员。不要公开 `.env`。

仅在可信局域网 HTTP 调试时，可显式设置 `LUMEN_COOKIE_SECURE=false`；生产站点使用 HTTPS。Caddy 示例见 `deploy/Caddyfile.example`。

```sh
sh deploy/linux.sh status
sh deploy/linux.sh logs
sh deploy/linux.sh stop
sh deploy/linux.sh update
```

停止不会删除数据卷。更新前备份 PostgreSQL 和独立保存的加密密钥。完整配置、Vercel 部署、密码恢复和同步规则见 [网站部署说明](docs/WEBSITE.md)。

## Vercel

在独立 `workspaces/vercel` 工作区部署，连接托管 PostgreSQL（推荐使用连接池地址），设置 `DATABASE_URL`、`LUMEN_CREDENTIAL_KEY` 和 `LUMEN_SETUP_TOKEN`。生产、预览和测试使用不同数据库及密钥。

在发布新版本前，使用受控部署环境显式执行 `npm run db:migrate`；构建和普通 API 请求都不会自动迁移数据库。运行时可使用连接池地址，迁移可通过 `DATABASE_MIGRATION_URL` 使用直连地址。Vercel 页面和 API 共用域名；音频仍直接由 CDN 提供。

## 开发

需要 Node.js 24.15+。开发数据库地址和密钥通过当前进程环境注入，应用不会自动读取 `.env` 文件（Compose 会读取）。

```sh
npm ci
npm run db:migrate       # 已配置数据库时显式执行
npm run typecheck
npm run build
npm start               # 页面 + API，默认 127.0.0.1:3000
npm run dev             # 另开终端启动热更新，/api 代理到本地服务
```

未配置数据库时，本地播放与搜索仍可用，账号、同步和公共在线播放保持关闭。

## 验证

```sh
npm run typecheck
npm run build
npm run test:server
npm run test:managed
npm run test:cloud
npx playwright install chromium
npm run test:site
npm run test:login
npm run test:library
npm run test:layout
npm run test:api
npm run test:sync
```

`test:managed` 和 `test:cloud` 使用隔离的 PGlite PostgreSQL 测试数据库，不需要本机 Docker，也不读取真实用户账号。`test:site` 使用构建后的网页，覆盖管理、注册、导入、跨设备关联和同步。

`npm run test:linux` **只在可用的 CI／Linux Docker 环境运行**：创建独立测试项目，验证数据库/应用重启后数据保留，并只清理测试项目的数据卷。当前本地工作环境不运行 Docker。

两个仓库的公共 `src/`、`server/`、`config/` 及关联测试、部署文档必须同步；不得覆盖 Vercel 独有的构建与网关配置。详见 `AGENTS.md` 和 `HANDOFF.md`。

## 上游与许可

网易云接口使用 [api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)（MIT）。这是非官方接口；账号有效、拥有会员或成功绑定均不代表所有歌曲都有可用音源。播放可用性仍受上游账号权限、资源及网络影响。字体随应用自托管。
