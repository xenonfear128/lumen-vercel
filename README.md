# Lumen 0.1.0 · Vercel 子工作区

本目录是原 Lumen 的独立源码副本，新增 Vercel 部署支持。原项目位于 `E:\Lumen`，本副本位于 `E:\Lumen\workspaces\vercel`。

**部署到 Vercel：导入本目录对应的 Git 仓库，使用 Node.js 24.x，保留仓库内的 `vercel.json` 配置即可。** 网页和同域 `/api` 一起发布，不需要购买服务器或另行部署网易云 API。

已于 2026-09-06 部署到个人 Hobby 项目：[打开 Lumen](https://lumen-vercel-neon.vercel.app)。网页和 API 均已通过真实云端验证，原工作区保持不变。

完整步骤、验证命令和限制见 [Vercel 部署说明](deploy/VERCEL.md)，本次结果见 [部署验证记录](deploy/VERCEL-VERIFICATION.md)。

以下保留原 Windows/Linux 产品说明。

本地与在线音乐播放器。提供 Windows 桌面应用和 Linux 服务器部署版，共用 React 界面与内置网易云 API（`@neteasecloudmusicapienhanced/api` 4.40.1）。

## Windows 用户

运行 `Lumen-0.1.0-Windows-x64-Setup.exe` 安装，可自行选择目录并创建快捷方式。安装后打开 Lumen 即可使用，不需要另装 Node.js、Docker 或单独启动 API。

- 桌面应用只启动一个实例，窗口大小、语言、主题、均衡器、在线歌单和收听统计保存在用户数据目录。
- 配套服务固定监听 `127.0.0.1:3000`，仅接受应用本次启动的访问凭证；退出 Lumen 时一并关闭。
- 如果 3000 端口被其他程序占用，应用会提示关闭占用程序，不会连接或终止不明服务。
- 当前源码支持刷新恢复全部播放列表、当前选择与曲目内容；本地音频存入当前浏览器/应用配置的 IndexedDB，不上传服务器。清除网站数据或应用数据会删除这些内容，不跨设备同步。已有安装包是否包含此改动请查看 HANDOFF.md。
- 首个安装包未配置发布者代码签名；正式公开发行可通过构建环境注入签名证书。

## Linux 服务器：一键启动

需要 Docker Engine 和 Docker Compose v2（支持 `--wait`）。解压服务器包后：

```sh
tar -xzf Lumen-0.1.0-Linux-server.tar.gz
cd Lumen-0.1.0-Linux-server
sh deploy/linux.sh start
```

首次启动自动创建 `.env`。默认地址是服务器本机 `http://127.0.0.1:8080`；Docker 同时交付网页和 API，由同一服务管理，无需维护第二个项目。

常用命令：

```sh
sh deploy/linux.sh status
sh deploy/linux.sh logs
sh deploy/linux.sh stop
sh deploy/linux.sh update
```

`stop` 不删除数据卷。更换版本时保留 `.env` 与 `lumen-data` 数据卷，再运行 `update`。

### 从其他设备访问

- 域名访问：将 `deploy/Caddyfile.example` 中的域名替换为自己的域名，交由宿主机 Caddy 提供 HTTPS，转发到 `127.0.0.1:8080`。
- 局域网直连：在 `.env` 中设置 `LUMEN_BIND_ADDRESS=0.0.0.0`，重新运行启动命令，通过 `http://服务器IP:8080` 访问。
- 可在 `.env` 中同时设置 `LUMEN_AUTH_USER` 和 `LUMEN_AUTH_PASSWORD`，为网页与 API 启用访问密码；公网使用时配合 HTTPS。

浏览器请求同域 `/api`，不会访问客户端的 `127.0.0.1`。语言、登录状态、歌单和统计保存在各客户端，不会自动跨设备同步。导入的本地文件属于访问网页的设备；本版本没有服务器磁盘曲库扫描功能。

### 不使用 Docker

在安装了 Node.js 22.12+ 的 Linux 上：

```sh
npm ci
npm run build
LUMEN_HOST=127.0.0.1 LUMEN_PORT=8080 LUMEN_DATA_DIR=./data npm start
```

生产运行可由 systemd 管理；也可在构建后 `npm prune --omit=dev`。

## 开发与打包

```sh
npm ci
npm run typecheck
npm run build
npm start                 # 网页 + API，默认 127.0.0.1:3000
```

前端热更新时，在服务之外另开 `npm run dev`；Vite 自动把 `/api` 转发至本地服务。端口约定在 `config/local-services.json` 中统一维护，界面不提供 API 地址输入框，旧缓存地址会自动清理。

Windows 打包在 Windows x64 上执行：

```sh
npm run desktop:setup     # 首次下载 Electron 运行时
npm run build
npm run desktop          # 本地运行桌面应用
npm run build:win        # 生成安装包到 release/
```

Linux 部署源码包：

```sh
npm run build:linux       # 生成 release/Lumen-0.1.0-Linux-server.tar.gz
```

音频默认通过 HTTPS 直接来自网易云 CDN，界面字体随应用内置，本地播放无需联网加载字体。原有可选音频代理仍可在在线音乐设置中配置，开发用示例是 `tools/audio-proxy.mjs`。如果自定义代理，HTTPS 网站也应使用 HTTPS 代理。

## 验证

```sh
npm run typecheck
npm run build
npm run test:server       # 服务路由、隔离、访问密码和错误处理
npx playwright install chromium
npm run test:api          # 三语言、开发与生产环境的 API 地址和配置迁移
npm run test:layout       # 405 项布局检查
npm run test:desktop      # Windows 启动、播放、关闭、端口释放
```

如果使用现成的 Playwright 工具运行时，可用 `PLAYWRIGHT_MODULE_PATH` 指定它的 `playwright/index.mjs`。桌面测试使用独立用户目录，不读取真实登录状态。

## 上游与许可

网易云接口由 [api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) 提供，受其 MIT 许可约束。它是非官方接口；在线播放可用性仍取决于网络、账号权限和上游服务。应用只使用用户自己的登录状态。Electron 及其依赖的许可随 Windows 安装目录中的许可文件交付。
