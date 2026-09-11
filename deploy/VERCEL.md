# 部署到 Vercel

这是从 `E:\Lumen` 复制出的独立子工作区；修改前的源码已作为本仓库的首个 Git 提交保存。原工作区没有 Git 历史，因此本副本是源码快照，不是 Git worktree。

当前正式站点：[打开 Lumen](https://lumen-vercel-neon.vercel.app)。项目为 `haruto-nitos-projects/lumen-vercel`，使用 Hobby 计划，2026-09-06 通过 CLI 发布。

## 首次部署

1. 将本目录作为独立仓库推送到自己的 GitHub、GitLab 或 Bitbucket。提交源码即可，忽略 `node_modules`、`.env`、`.vercel`、构建输出和测试结果。
2. 在 Vercel 创建项目，导入这个仓库。Root Directory 选择仓库根目录；如果上传的是整个父目录，则选择 `workspaces/vercel`。
3. 框架选择 Vite，Node.js 选择 24.x。仓库内 `vercel.json` 已指定：
   - Install Command：`npm ci --ignore-scripts`
   - Build Command：`npm run build:vercel`
   - Output Directory：`dist-vercel`
4. 点击 Deploy。初次使用无需设置 API 地址、服务器端口、数据库或登录 Cookie 环境变量。
5. 在生成的 HTTPS 域名上检查 `/api/healthz`，再验证搜索、扫码登录和播放。健康检查只证明函数可启动，不代表网易云上游可用。

也可在本目录使用 Vercel CLI：`npx vercel` 创建预览部署，确认后再用 `npx vercel --prod` 发布生产版。首次运行需要登录并关联项目。本工作区已关联项目；本次使用的 CLI 位于 `.tools/vercel-cli`，登录配置位于 `.tools/vercel-auth`，均已排除提交和上传。使用该 CLI 时附加 `--global-config .tools/vercel-auth --scope haruto-nitos-projects`。

## 运行方式

- 网页、字体和封面从 Vercel 静态资源层加载。
- `api/gateway.js` 是唯一的 Node.js 函数入口。`vercel.json` 将 `/api/:path*` 显式重写到该入口，保留原始请求路径；`/api/cloudsearch`、`/api/login/qr/create` 等多层路径由同一函数处理，无需常驻进程或 Docker。
- 界面继续请求同域 `/api`。生产环境不会调用访问者电脑上的 3000 端口，也不需要填写后端域名。
- 仅初始化一次 SDK，随后复用函数实例；Cookie 始终来自各次请求，登录结果不进入共享缓存，API 响应禁止 CDN 缓存。
- 临时匿名 Token 使用函数可写的临时目录，丢失后可重建；它不是持久化存储。客户端设置和登录状态仍保存在各自浏览器。
- 获取播放地址前会按需注册上游公开加密密钥，并写入函数临时目录。并发首次请求共享初始化结果，失败可重试；不会依赖开发机器已有的缓存。
- 音频由浏览器直接通过 HTTPS 连接网易云 CDN。这里没有新增音频转发、音频存储、数据库或定时保活服务。
- 默认函数区域为东京 `hnd1`，最大执行时长 30 秒。区域可以在 `vercel.json` 修改，但不能据此保证音乐版权区域和上游访问条件。

## 验证命令

需要 Node.js 24：

```sh
npm ci --ignore-scripts
npm run build:vercel
npm run test:vercel
npm run test:vercel:bundle
npx playwright install chromium
npm run test:vercel:browser
node tools/vercel-cloud-check.mjs https://lumen-vercel-neon.vercel.app
```

`test:vercel:bundle` 使用固定版本的 Vercel 官方 Node 构建器生成函数文件，随后限制模块解析范围，在隔离的函数目录内验证启动和二维码生成。测试不需要 Vercel 登录，不等价于云端部署。

`test:vercel:browser` 在本地模拟静态资源响应头及 API 路径，检查中、英、日三种语言、隐藏地址设置、CSP、字体、旧 HTTP 封面升级、动态音频解析模块和 WAV 播放。当前检查结果见 [验证记录](VERCEL-VERIFICATION.md)。

普通 `npm run build`、`npm start` 和原有 Windows/Linux 命令仍使用原来的单文件构建；Vercel 构建单独写入 `dist-vercel`。

## 使用限制

- Vercel Hobby 限个人、非商业用途，并受免费额度约束；额度用尽可能暂停服务。
- 上游网易云的网络、账号权限和风控会影响在线功能，必须在实际部署域名验证。本地构建不能证明东京函数出口可正常登录和获取所有歌曲。
- Windows/Linux 的 `LUMEN_AUTH_USER`、`LUMEN_AUTH_PASSWORD` 不用于此静态托管方案。需要私有访问时，使用账号计划支持的 Vercel Deployment Protection；不要误以为仅设置这两个环境变量就保护了整个网页。
- 自定义音频代理需要 HTTPS，不能在 HTTPS 网页中填写普通 HTTP 代理。
- 本地文件由浏览器读取，重开网页后需要重新选择；没有服务器磁盘扫描或跨设备同步。

官方参考：[Node.js 函数](https://vercel.com/docs/functions/runtimes/node-js)、[项目配置](https://vercel.com/docs/project-configuration/vercel-json)、[Hobby 计划](https://vercel.com/docs/plans/hobby)。
