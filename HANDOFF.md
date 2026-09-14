# Lumen 交接留言板

最后更新：2026-09-14（最新修复与验证见文末；开始工作前先读，完成后更新）。

## 当前状态

2026-09-14：v0.2.0 网站账号、公共音源和云同步已推送根项目及 Vercel 两个 GitHub 仓库，生产部署已更新至 https://lumen.rupa.best ，后端函数固定新加坡 sin1。线上三语言、搜索、本地播放与匿名播放拒绝检查通过；Linux 数据卷重启恢复已由 GitHub CI 验证。生产环境尚未设置数据库、音源加密密钥和初始化口令，账号/在线播放/云同步保持关闭。真实托管数据库连接与真人扫码会员播放仍待配置后验收。最新发布证据见文末。

## 工作区与部署

- `E:/Lumen`：Electron Windows 与 Linux 服务器版。
- `E:/Lumen/workspaces/vercel`：独立 Vercel 项目，产物 `dist-vercel`，入口 `api/gateway.js` → `server/api-handler.cjs`。
- 公共 `src/`、`config/`、`server/` 应保持一致；`server/api-handler.cjs` 仅 Vercel 使用。根目录执行 `npm run test:sync` 检查，勿覆盖两边不同的构建配置。
- 当前正式部署：`dpl_BoMTRdZrjRiziD8U9MLWwqm4tUCq`，域名 https://lumen.rupa.best ，已包含字体升级、语言切换动画和移动播放器布局修复。

## 本轮修复

1. **扫码服务**：新增 `server/qr-login.cjs`，直接使用 SDK request primitive 调用相同 QR endpoint，避开 SDK QR module 的 catch 作用域错误。保留真实 800/801/802/803；异常及缺失成功凭据抛出，由 API 层输出通用 502。删除“异常伪装成 801”等待状态的旧适配器。
2. **扫码客户端**：未知状态、空成功 Cookie、登录状态错误均视作错误；请求设置 25 秒超时。保留新 Cookie 查询、稳定依赖与串行有限重试；账号页显示独立错误并可重新查询登录。二维码生成/刷新、关闭面板及退出登录使用代次标记，旧响应不能回写新会话。
3. **播放**：区分服务请求失败、上游无地址、媒体播放失败；请求失败停止并可重试，不作为无音源自动跳过。切歌立即停止旧音频，陈旧请求不能清除新请求加载状态；删除加载中的歌曲/歌单会使旧请求失效。
4. **持久化**：歌单与统计使用独立保存计时器，统计保存读取最新数据；离开页面保存在线歌单；清空统计同步更新 ref。
5. **布局**：修复统计页超长曲名/歌手名将窄屏弹窗撑宽，约束网格最小宽度和统计数字区域。三语言错误文案同时适配本地和云端。
6. **打包与维护**：Linux tar 使用相对输出文件名，兼容 GNU 与 Windows BSD tar；新增共享代码一致性检查。CI 加入登录行为测试。

## 验证证据

- 根与 Vercel 类型检查、最终生产构建：通过；Vercel CSP/静态资产检查通过。
- 根服务测试 + 新 QR 适配器单测：9/9。
- Vercel 入口/密钥初始化 + 新 QR 单测：12/12。
- `npm run test:login`：3 项 QR 单测 + 浏览器场景（播放进度刷新期间登录、暂时失败后恢复、新 Cookie 查询与刷新保持、8 次失败停止并显示错误、旧 QR 响应隔离、两类音源错误、删除待加载歌单）。客户端另外覆盖空凭据/异常状态拒绝。
- 真实上游请求：新适配器用新建的未扫描 key 返回 HTTP 200/code 801；没有使用用户账号授权。
- `tools/layout-check.mjs`：中英日、9 种视口、15 场景，共 405 项通过。修正了测试在刷新前写 localStorage 被卸载保存覆盖的问题，改为导航初始化注入，统计长文本场景现已真正覆盖。
- API 地址绑定浏览器测试：开发/生产 × 三语言，6 场景通过。
- Vercel 本地生产预览：三语言静态资产、真实 API、CSP、HTTPS 封面、本地 WAV 播放通过。
- Electron 源码启动：私有 API、渲染隔离、本地 WAV、媒体元数据、退出释放端口通过。最终打包程序的验收结果见 `release/BUILD-NOTES.md`。
- Windows 安装包及 Linux tar 已重建；SHA256SUMS 与最终包验收见 release 目录。

## 对旧交接结论的纠正

- 原“6 项 server 测试覆盖扫码适配器异常路径”不准确：该测试注入 fake API，调用 logout，只验证服务层错误脱敏。此次新增的是实际 QR adapter 函数测试。
- 原“异常返回 801 可以有限重试”不准确：前端把它当正常等待并清零失败次数，可能无限等待；已移除。
- `803` 但 Cookie 为空不意味着二维码过期；现在报凭据响应错误，不写空会话。
- “生成二维码/编译成功”不能证明真人登录成功，轮询问题是否是用户现场唯一根因尚未证实。

## 下一步与边界

- 本轮源码已上线。后续继续从 `workspaces/vercel` 部署，不要把根目录的单文件 Vite 配置覆盖过去。
- 真人扫码验收仍需用户在实际 Lumen 界面扫码并确认，验证身份显示、刷新后保持、账号权限歌曲。不要另生成一张二维码让用户扫，避免与应用轮询的 key 不一致。不得输出 Cookie/token 原文。
- 部分歌曲不可用仍可能涉及上游资源、账号、音质和网络出口，不能保证所有音乐可播放；本轮修复使错误可区分。
- Linux 容器在真实 Linux 环境、Windows 安装/卸载交互、发布者签名尚未完成本轮验证。没有改全局 Git 安全配置，也未读取/输出部署凭证。

## 时间线

- 9/6 早至晚：前一轮修复 stale closure、轮询依赖，补齐根项目 xeapi-key，重建发行包。
- 9/6：前一版已部署到 lumen.rupa.best（部署 ID 见上），线上搜索与播放冒烟通过，但没有真人登录验收。
- 9/6 本轮：先读旧 HANDOFF，纠正错误适配逻辑与覆盖说明，完成跨工作区修复、回归、构建和发行包更新。

- 9/6 后续：按用户要求正式部署 dpl_HyYBeDcf2Auk1cRpuRpWAVSCQsRF；云端构建/CSP、正式域名真实搜索、在线播放、QR 生成及等待状态 801、三语言浏览器验收通过。真人扫码授权仍未执行。
- 9/6 晚：完成 my-playlists 自动加载 + 三态修复（根与 Vercel 源码同步），补三场景回归测试，发布 Vercel 生产，重建 Windows/Linux 发行包。
- 9/6 晚（二）：修复侧边栏播放列表行悬停出格。根因：行按钮 `.btn:hover` 的 `scale(1.045)` 把整行放大，而列表容器 `overflow-y-auto`（等价 `overflow-x:auto`）在边缘裁切，删除按钮被切一半。Tailwind v4 的 `hover:[transform:none]` 任意值**不生成 CSS**，故新增明确的 `.btn-row` 覆盖类（hover/active/focus 均 `transform:none`），Sidebar 行改用它；列表行保留背景色悬停反馈。已同步根与 Vercel，生产实测 `transform: none`、`clippedX: 0`；`test:layout` 405 项通过；已部署生产并重建发行包（Windows/Linux，SHA256SUMS 已更新）。

- 9/12：语言切换改为滑动活动胶囊，支持 `prefers-reduced-motion`；移动端播放面板压缩封面区、元信息和控制间距，封面保持至少 100px，并让播放模式与可视化模式两组设置在 320×568 首屏可见。根与 Vercel 公共 UI 文件已同步，三语言 405 项布局检查通过。
- 9/12：Phase 1 字体与 UI 改动已发布 Vercel 生产，部署 `dpl_BoMTRdZrjRiziD8U9MLWwqm4tUCq`，正式域名 API/搜索/CDN 播放/QR/CSP 及中英日浏览器检查通过；线上 320×568 移动检查确认语言指示器移动和可视化设置首屏可见。

## 字体升级（2026-09-12，Phase 1）

- 将 `@fontsource-variable/inter` 替换为自托管 `@fontsource-variable/geist` 5.3.0（OFL-1.1），覆盖拉丁、西里尔、希腊和越南字符；JetBrains Mono 保留。
- `html.lang` 同步写入 `data-lang`，CSS 按语言切换 CJK 回退链：中文不回退到日文字形，日文不回退到中文字形。当前不内联 Noto SC/JP，避免 Electron 单文件从约 3MB 增长到 15MB 左右。
- 删除 Inter 专属 `cv11`/`ss01` 与 body 级 `tnum`；时间、码率和统计区域继续使用现有 `.tnum`/`font-mono`。
- 根与 Vercel 均通过干净 `npm ci --ignore-scripts`、类型检查、生产构建、405 项布局检查、字体实际加载、登录/持久化/API/Vercel 浏览器回归。桌面单文件构建约 2.998MB；Vercel 字体按分片输出。
- 这次只完成 Phase 1，未添加 CJK webfont；后续若需要跨设备字形一致性，应先实测 Electron 启动成本，再决定外部字体资源或内联方案。

## 字体方案调查结论与执行约束（2026-09-12）

以下保留升级前的实测数据，并记录已执行的 Phase 1 约束，接手方不必重跑。

**升级前现状**：`Inter Variable` + `JetBrains Mono`（均 fontsource 自托管）；CJK 只有字体**名**回退，未打包 → 中日文实际用系统字体。无 Google Fonts 外链。

**实测数据（本轮 npm pack 真实测量）**

| 字体 | 可变轴 | 西里尔 | woff2 总量 | 许可 |
|---|---|---|---|---|
| Inter Variable（现用） | 100–900 | ✅ | ~200KB | OFL |
| Geist Variable | 100–900 | ✅ | 154KB / 10 片 | OFL-1.1 |
| Noto Sans SC Variable | 100–900 | 拉丁片 | 4.3MB / 101 片 | OFL |
| Noto Sans JP Variable | 100–900 | — | 5.0MB / 124 片 | OFL |

**构建事实（关键，别按包大小猜）**：桌面单文件构建会把**所有字体内联成 base64**。当前 dist 内 19 个 `data:font/woff2`，`dist/` 下**只有 `index.html`**、无外部 `.woff2`；内联字体原始 299KB，base64 后约 398KB，`index.html` 3.04MB。故内联 SC+JP ≈ 9.3MB 原始 → base64 后约 12.4MB，HTML 会到 **~15MB**。

**结论**：Phase 1（换 Geist + 补全语言回退链）**体积反而略降**（200KB→154KB），零成本；Phase 2（内联 CJK）代价明确，需先决定是否接受 15MB 单文件，或把桌面字体改为外部资源（属构建改造，非纯 CSS）。

**若执行，必须注意**

- 拉丁/西里尔**始终由 Geist 承担**（`unicode-range` 分流），三语模式下的俄语曲名/歌单名字形才一致。
- 回退链**按语言整套切换**；中文链不得给日文兜底，否则用户数据里的汉字会渲染成中文字形（"直/骨/取"中日有别）。
- 删除 [index.css:76](E:/Lumen/src/index.css:76) 的 `:lang(ja) body` 规则——它把 Inter 排在 Noto JP 之前，正是字面高度/字宽不一致的来源。
- 删除 `font-feature-settings: "cv11","ss01"`（**Inter 专有**，换字体后无效/触发未知特性）；`body` 级 `tnum` 也撤掉（时间/码率/统计已由 `.tnum` 类与 `font-mono` 精确施加，见 index.css:295）。
- 字重用整数档 400/500/600/700（避免与未来 CJK 混排时字重跳变）。
- CJK 系统字面比 Inter 高约 8–12%，`h-7/h-8/h-9/h-10` 与 `leading-*` 需逐档复核，不能只换字体名。
- 验证补充：`document.fonts.check()` 确认真的加载而非静默回退；覆盖**长歌名与俄语文案**；Electron 离线启动；Vercel 构建体积（应略降）。
- JetBrains Mono **保留**（换 Geist Mono 只省 ~20KB、只赚视觉偏好，不值得多验一套数字字形）。

## 后续：播放列表刷新恢复（2026-09-06）

用户确认扫码登录已成功，随后要求刷新保留列表和内容。新增 src/lib/libraryStorage.ts：lumen.library.v1 同步保存全部列表（含 temp/folder/netease）、视图/队列/当前曲目；自动迁移 lumen.online.v1。IndexedDB lumen-library/files 保存本地 File，恢复时重新读取封面元数据，不存失效的 blob URL。删除操作有 localStorage tombstone，刷新打断时下次继续清理。存储失败会在三语言界面提示。数据限当前浏览器/配置与域名，不上传音频、不跨设备同步，清除站点数据会丢失。

新增 npm run test:library，支持传正式 URL：混合临时列表、当前选择、刷新和关闭重开后真实本地播放、文件字节完整性、删除持久化与缓存清理、旧歌单迁移；开发与正式生产页面均通过。两边类型检查/生产构建通过，公共源代码一致；实际线上搜索、播放和 QR 冒烟检查通过。新版部署 ID 见上。发行包未重新生成，后续若发 Windows/Linux 包需重建。

## 新反馈交接：我的歌单一直显示“导入中…”（已修复并部署 2026-09-06）

用户反馈“我的歌单一直显示导入中…”。已修复、验证并上线到 Vercel 生产。

- **根因**：`OnlinePanel.tsx` 的 myLists 初始为 null，原“我的歌单”渲染成“点击后才调用 loadMyLists() 的按钮，但按钮文案误用 t.importing（导入中…）”；没有进入导入页自动加载的调用，因此没点击时也永久显示“导入中”。
- **修复**：
  - 已登录进入“导入”标签页时**自动加载**我的歌单（`useEffect` 依赖 tab + accountUid + loadMyLists + myListsRefresh）。
  - 三态区分：**读取中**（`myPlaylistsLoading`）／**空列表**（`myPlaylistsEmpty`）／**接口失败**（`myPlaylistsError` + 重试按钮）。成功/错误均有用 seq 守卫，旧响应不能回写新会话。
  - 新增 i18n 三语言 key：`myPlaylistsLoading`/`myPlaylistsEmpty`/`myPlaylistsError`。
  - 移除了会误显示的“导入中…”按钮。
- **回归测试**：`tools/login-check.mjs` 新增 `my playlists list/empty/error` 三个浏览器场景，`npm run test:login` 全部通过。
- **验证**：根与 Vercel `tsc` 通过；`test:login`（QR 3 单测 + 浏览器 success/failures/stale + 音源错误 × 2 + 删除待加载 歌单 + my playlists × 3）、`test:library`（2 项）、`test:vercel`（9 项）、`test:vercel:bundle`、`test:vercel:browser`（三语）全部通过。
- **部署**：已用 `.tools/vercel-cli --global-config .tools/vercel-auth --scope haruto-nitos-projects --project lumen-vercel`发布生产。线上 bundle 已确认含 `我的歌单`/`暂无歌单`/`读取歌单失败`；`node tools/vercel-cloud-check.mjs https://lumen-vercel-neon.vercel.app` 全通过（真实搜索、CDN 播放、三语 UI + CSP）。
- **发布包**：根目录 Windows `Lumen-0.1.0-Windows-x64-Setup.exe`（22:47）与 Linux 包（22:47）已重新构建，`SHA256SUMS.txt` 已更新，包含 my-playlists 修复。
- **遗留**：真人扫码验收仍需用户在实际 Lumen 界面扫码确认（见“下一步与边界”）；不要再生成独立二维码让用户扫。

- 9/12 后续：字体回退与语言滑块对齐修复已部署生产 dpl_5yGPBR9aTGH3xbQyS7Jc8szr94JW，正式域名 https://lumen.rupa.best。Vercel 云端类型检查、生产构建、静态资产/CSP 检查通过。日文字体链在 JP 字体后追加 SC 兜底，仅用于缺失字符；系统字体的跨设备外观仍需现场确认。


## 9/12 中文名称局部字体突变再次修复

- 上一版仅增加日文链末尾中文回退，未解决混排：CDP 实测“俄/斯/后/朋/克”为 Yu Gothic UI Semibold，“罗”为 Microsoft YaHei UI Bold。元素尺寸检查不足以证明字形一致。
- 新增 src/lib/metadataTypography.ts：保守的简体字符提示命中时，整段名称使用 --font-zh 并标 lang=zh-CN；假名优先使用 --font-ja；不明确的名称保留原字体。不是通用语言识别，纯汉字日文/繁体等歧义不自动推断。
- 覆盖队列标题、侧栏歌单、歌曲标题/艺人/专辑、搜索名称、导入歌单、统计名称，两工作区同步。
- tools/metadata-font-check.mjs 用真实持久化歌单 fixture 和 CDP CSS.getPlatformFontsForNode 验证截图标题的六个汉字同一字体；支持传正式 URL。三语言本地检查通过，截图 test-results/metadata-title-ja.png；405 布局检查和类型检查通过。
- 已发布 dpl_Cn8h1nTXaioFssEXHTiRR7MJwW8r 至 https://lumen.rupa.best；正式域名三语言 CDP 字形检查通过：六个汉字全部 Microsoft YaHei UI Bold，拉丁为 Geist。

## 9/12 移动播放器间距修复
- 用户 iPhone 截图显示播放器下方留白、控制区拥挤。原移动规则对所有高度固定 17dvh 封面区且取消 flex-grow；改为封面区使用剩余空间，封面尺寸由画布实际宽高约束。
- App 播放器外层增加 player-panel，移动端 size container；可用内容高度 >=440px 才增大标题/进度/播放/设置间距。去掉设置组玻璃厚边框与阴影。
- <=600px 矮屏减少面板内边距、隐藏次要元数据 chips、频谱叠放到封面区底边，保持主要控件首屏可见。桌面不受这些移动规则影响。
- 新增 tools/mobile-spacing-check.mjs（可传正式 URL），持久化真实歌曲 fixture，320x568 /393x668 /430x780、三语言、四可视化模式共36场景验证封面>=100px、设置首屏可见、底部空白<45px。根/Vercel同步。截图 test-results/mobile-spacing.png。
- 405 布局检查通过；最终矮屏分支通过36项专项检查；类型与根构建通过。未进行物理 iPhone Safari 验收。
- 已部署 dpl_5UATaRk4NcAXP4BvMaMnhiGusBFZ，正式域名 https://lumen.rupa.best；云端类型/构建/CSP 及线上36项手机间距检查通过。

## 9/12 用户指定 L 图标
- 用户上传的金属 L 图用作品牌标识，原始图保存 build/icon-source.png；裁剪区域 (208,200)-(1040,1032)，不重新生成设计。
- src/assets/brand：96px UI 标识、32px favicon、180px apple-touch-icon；TopBar 替换原圆环；两份 index.html 加图标链接。根与 Vercel 已同步。
- build/icon.png 为512px，icon.ico 包含16/24/32/48/64/128/256px。仅更新桌面打包资源，未重打安装包。
- 根生产构建现在除 index.html 外还有 favicon 和 apple-touch PNG（Vite singlefile 不内联 link 图标）；现有 dist/**/* 打包规则会包含它们，不要只拷贝 index.html。类型检查/根构建/公共源码同步检查通过。
- 新图标已部署 dpl_9CtvgKCjtm39rdAaaTZGTrccDje3 至 lumen.rupa.best，线上 UI 图片解码、favicon/touch 图标 HTTP 与 MIME 检查通过，截图 test-results/new-icon-header.png。

## 2026-09-14 服务图标修复与 GitHub 同步

- 用户明确要求：根项目与 `workspaces/vercel` 今后每轮修改都必须同步。两边新增相同的 `AGENTS.md`，记录公共源码、关联测试/资源同步和各自构建配置保留规则；交接文档也同步到 Vercel 仓库。
- 修复 Windows/Linux 配套服务的 favicon 与 Apple Touch 图标 404：Vite singlefile 仍将这两个 PNG 输出为独立文件，原服务只响应 HTML/API。现在启动时只读取构建目录中符合命名规则的图标，支持 GET/HEAD、PNG MIME 和长度；继续执行访问密码/桌面凭证检查，不把请求路径直接映射到磁盘。
- 两边同步新增服务回归测试：读取构建 HTML 的实际图标地址，验证真实字节、HEAD、405、404、访问密码及桌面凭证。Linux CI 调整为先安装 Playwright Chromium 再运行字体检查。
- 本轮 GitHub 更新同时纳入此前未提交的 Geist 字体、中日元数据字体修复、语言滑块、移动布局和用户指定 L 图标，以及相应验证工具；保留 Vercel 独立构建与测试输出目录配置。
- 本轮实测通过：根/Vercel 类型检查；根生产构建；Vercel 生产构建与 CSP/资产检查；公共 src/server/config 一致性；根服务 + QR 11 项；Vercel 入口/密钥 + QR 12 项；三语言字体与真实汉字字形检查；405 项布局、36 项移动间距；登录/旧请求隔离/我的歌单/播放错误/删除待加载歌单；混合歌单与本地字节刷新恢复/删除/旧版迁移；Electron 私有服务、渲染隔离、本地 WAV、媒体元数据与退出释放端口。
- Vercel 密钥测试最初因本地沙箱目录写入权限失败，允许测试在正常权限下运行后 12 项全部通过，并非密钥逻辑错误。
- 本轮未重建 Windows/Linux 发行包，也未单独执行 Vercel CLI 部署；GitHub 推送后的 CI/自动部署状态需以平台结果为准。未使用真实用户账号扫码授权。

## 2026-09-14 网站账号、公共音源与云同步

### 已实现

- 新增显式 PostgreSQL 迁移、scrypt 密码、令牌哈希会话、来源/CSRF 校验、一次性初始化口令、邀请码事务注册、修改密码与管理员一次性重置凭据。禁用/重置使会话失效，保留最后一个管理员。
- 新增中英日网站账号面板及独立 `/admin`，包含公共音源、用户与邀请码、服务状态。扫码代次/所有者/过期时间保存在数据库，旧响应、取消或已注销的会话不能覆盖绑定；新账号验证失败保留旧绑定。
- 公共音源凭据使用服务端 AES-256-GCM 加密，只有播放与管理员检查使用。在线播放强制 Lumen 会话，忽略请求里的个人 Cookie；账号故障停止自动切歌，单曲缺失有限跳过。个人网易云登录仍仅用于自己的歌单。DB 限流跨实例共享。
- 新增按用户隔离的缓存、文件命名空间、持久化待提交操作与游标增量同步；歌单/条目/文件标识独立，删除保留标记。收听时间按 15 秒分段，事件去重；清空统计切换代次。
- 修正临时歌单与网易云导入歌单的固定标识：登录用户重新创建临时歌单、重新导入已删除网易云歌单时使用新标识；存续歌单按网易云资源标识去重，立即播放使用实际列表标识。
- 旧数据需明确同意导入，原访客数据保留；导入标识与统计分块去重。音频/本地封面/路径/Blob URL 不上传，其他设备支持缺失文件提示与手动关联。设备播放设置不云同步。
- Linux Compose 增加独立 PostgreSQL 卷及显式迁移服务；部署脚本只生成缺失的密钥。Vercel 保留专用网关、拆分构建和 CSP。新增 `docs/WEBSITE.md` 配置、升级、备份与验收说明。
- 自动 Windows 打包已暂停，桌面源码保留。用户明确禁止调用本地 Docker；后续仅允许在 CI 或另行授权的远程 Linux 环境进行容器验证。

### 实际验证

- 根与 Vercel 类型检查、生产构建、公共源码一致性通过；Vercel CSP/资产、隔离函数打包及三语言浏览器回归通过。
- 账号/公共音源/同步服务测试 6 项通过，分别经根 HTTP 服务与 Vercel API handler 执行：并发邀请码消费、过期/撤销、权限、会话失效、CSRF、单曲请求限制、DB 限流、凭据隔离、扫码取消/注销迟到响应和替换失败保留绑定。
- 云同步客户端测试 4 项通过：两设备离线合并、删除不复活、未提交时长恢复/去重、清空统计隔离、账号缓存隔离和 105 首旧统计分块导入/重复提交。
- 构建页面端到端检查通过：管理员初始化/模拟扫码绑定/邀请码、用户注册及明确导入、第二设备缺失文件/手动关联/本地播放与统计、远程删除、账户数据隔离、三语言手机管理员布局。
- 原根服务与 QR 11 项、Vercel 服务/密钥/QR 12 项、登录/个人歌单/持久化/API 回归通过。三语言 405 项布局、36 项移动间距、字体加载检查通过。字体测试已适配异步账号初始化，等待实际应用控件后读取字形设置。
- 数据库测试使用 PGlite 的 PostgreSQL WASM 实现和真实 SQL；二维码与会员凭据使用模拟适配器。这些测试不代表真实会员账号已绑定或真实 PostgreSQL 多进程连接池已验收。

### 尚待部署验收

- 本轮没有推送 GitHub、执行生产迁移或部署，也未重打发行包。配置测试/预览/生产独立数据库与密钥后，按 `docs/WEBSITE.md` 执行显式迁移和部署。
- `tools/linux-check.mjs` 已接入 CI，用独立测试项目检查数据卷重启后的账号会话与歌单；本机未运行，不能标记为通过。不得调用用户本地 Docker。
- 在真实部署 `/admin` 页面由部署者扫码确认，再用受邀账号验收会员歌曲 CDN 播放；生成二维码、返回等待状态或模拟测试不能代替此步骤。
- 当前首次同步返回完整快照及当前统计代次事件；面向超大曲库/长期高频统计时，应在规模测试后增加快照分页或聚合压缩。同账号多标签页共享本地缓存，尚未专项验证并发标签页写入；多设备使用独立缓存的测试已通过。

## 2026-09-14 v0.2.0 发布准备

- 用户已授权同步推送两个 GitHub 仓库并部署 Vercel。版本号更新为 0.2.0，桌面自动打包继续暂停。
- 发布前两边与远端 main 一致，无需合并；公共源码一致性和 diff 检查通过，沿用前述已经通过的功能/构建验证。
- Vercel 生产环境变量清单为空：尚未配置 PostgreSQL、凭据加密密钥和初始化口令。因此发布后账号、在线播放和云同步保持关闭；访客搜索与本地播放继续提供。不能将上线等同于完成真人会员播放验收。
- 官方文档已核实：函数支持固定新加坡 sin1（Hobby 支持单一区域）；静态资源仍由全球 CDN 分发，数据库位置需单独设置。本次仅确认可行性，保留现有东京 hnd1。
- Vercel 线上验证工具改为检查匿名播放被拒绝，不再以旧版匿名在线播放成功作为验收条件。

## 2026-09-14 新加坡迁移与线上检查

- 第一轮生产部署已就绪：dpl_9S91hSyxgtjPxWWGx1p8Kh16hyvA，lumen.rupa.best 版本接口返回 0.2.0，/admin 可访问；线上三语言搜索、本地 WAV、CSP 和匿名播放拒绝检查通过。生产数据库仍未配置。
- 用户随后明确指定后续数据库在新加坡，因此 Vercel 函数区域从东京 hnd1 改为新加坡 sin1；共享部署说明同步到两仓库。
- GitHub Vercel 作业首次运行到 test:managed 失败。检查发现它只构建 dist-vercel，却先调用依赖根 dist 的默认 HTTP fixture；删除该重复步骤，保留 LUMEN_TEST_VERCEL=1 的真实 Vercel handler 测试。Linux 作业继续负责根服务测试。
- GitHub CLI 未登录，自动审批禁止从 Git credential helper 读取凭据用于 API；已停止该路径。CI 状态改由公开 GitHub API 查询，推送继续使用既有 Git 身份。

## 2026-09-14 v0.2.0 新加坡生产部署完成

- 正式地址：https://lumen.rupa.best 。最终部署 dpl_EzX24tLYwheVX7Ti99zUM73uL2Vs，状态 Ready，Vercel inspect 明确显示 api/gateway [sin1]。云端构建在 iad1 不影响函数执行区域；运行区域以函数构建详情为准。
- 发布源码：根功能提交 3b6c8be，Vercel 新加坡配置/CI 修正提交 460c3cc。两仓库 main 已推送，v0.2.0 源码标签包含本次功能与发布文档；未生成 Windows 安装包。
- 正式域名版本接口返回 0.2.0，/admin 返回应用页面。迁移后线上真实搜索、歌曲信息、QR 生成、匿名播放拒绝、请求来源隔离和中英日浏览器本地 WAV/CSP 检查通过。
- Linux 数据卷测试已在 GitHub 两仓库执行并通过：root run 34858520433、Vercel repo run 34858540219 的 linux 作业，涵盖显式迁移、数据库/应用重启及会话和歌单恢复。新加坡配置提交后的 Vercel 作业 run 34859191412 也已通过。全程未调用本地 Docker。
- 后续待部署者配置新加坡 PostgreSQL、LUMEN_CREDENTIAL_KEY、LUMEN_SETUP_TOKEN 并显式执行迁移，再部署启用账号功能。未读取或录入真人公共音源凭据，会员歌曲仍须实际管理员扫码验收。

## 2026-09-14 批量同步超时修复

- 用户截图 exchange 在 25.02 秒取消；Vercel 官方请求日志确认连续 POST /api/sync/exchange 在 30 秒触发函数超时，用户确认载荷包含大量操作。数据库只读活动快照未发现等待锁，不能据此排除其他时刻争用。
- 原客户端一次提交最多 100 操作，服务端每项执行多次串行 SQL，容易在托管数据库延迟下整批超时。客户端改为 10 项小批；服务端按 8 秒处理预算提前提交已完成操作，仅确认已处理 ID，剩余由原持久队列继续提交。保留幂等、顺序与删除标记规则。
- 新增带模拟数据库往返时间的 105 首歌回归，验证分批/部分确认/最终条目数和游标。账号及同步 11 项通过；根/Vercel 类型、构建、CSP 通过，公共源码同步。
- 本轮不修改生产表、账号或待同步内容；无需重新迁移。部署后用户刷新页面使客户端小批策略生效，真实用户积压是否清空需结合后续运行确认。

## 2026-09-15 v0.3.0 云端客户端实现（尚未公开发布）

- 用户明确恢复 Windows/macOS/Android 开发；新增文档 `docs/CLIENTS.md`、独立客户端协议/会话迁移、固定云端传输、SQLite/设备安全存储及文件引用。
- 桌面不再启动服务或监听播放 API 端口。受控 lumen 协议加载本地 UI，并提供带账号范围的音频资源与 Range；增加托盘、关闭行为、休眠暂停、明确退出和手动更新入口。设备令牌和个人 Cookie 不进入 React。
- 新增 Kotlin/Capacitor Android 工程：Media3 服务持有播放队列和系统媒体控制、SAF 持久授权、Keystore、SQLite、十段 PCM EQ/预放大与输出频谱，后台统计事件使用独立原 ID 提交。
- 新增官网 `/downloads` 和版本清单。清单保持未发布，不提供虚构下载链接。Android CI 发行打包要求固定签名密钥；调试 APK 仅作构建验证。Windows 包标注未签名测试版。
- 已实际验证：根/Vercel 类型与 UI 构建；根25项服务/QR/会话/同步/设备传输测试；Vercel managed/handler 13项及公钥3项；网页版 QR/个人歌单/播放错误/删除迟到请求回归；本地字节持久化和旧歌单迁移；网站账号/管理员/两设备同步/缺失文件关联/统计/三语言手机管理页面。
- Windows 真实打包程序通过沙箱、受限接口、原文件选择、Range、SQLite 重载、关闭驻留；另外模拟旧 Electron origin 执行了一次性迁移，验证旧音频保留和旧 Cookie 排除。生成了 `release/Lumen-0.3.0-Windows-x64-UNSIGNED-TEST.exe`，系统签名状态 NotSigned；最终打包内容门禁确认无 server/node_modules。
- 本机项目私有工具目录补齐了 JDK21/Android SDK36（未调用 Docker）。Android assembleDebug、JUnit EQ测试与 lintDebug 已运行通过；测试音覆盖中间8频段、两端搁架、预放大、旁路、输出频谱。后续改动须再次运行对应验证。
- 真实生产公共会员播放、Android真机30分钟锁屏跨曲/来电/蓝牙/拔耳机、三端覆盖升级、macOS两架构硬件、固定Android发行签名及备份仍未验收。不得将构建成功等同于上述通过。
- 生产迁移和生产部署尚未执行；新后端上线前必须显式执行002迁移。Vercel区域仍为sin1。公开发布须等待计划中的签名/真机验收。

- 追加验证：405项中英日播放器布局通过；发现并修复手机顶栏下载链接挤占语言切换宽度。GitHub root run 34878734245 的 Windows/macOS 作业已通过，包含macOS Intel/Apple Silicon DMG与macOS运行时自动化（不等于两架构实体设备验收）。代码已推送两个仓库的 codex/cloud-clients 独立分支，生产main未变。

- 首轮root客户端CI 34878734245 三平台全部成功：Windows未签名安装包和macOS两架构未签名DMG已经作为Actions artifacts生成。Android作业执行编译、测试音JUnit和lint，通过但未输出发行APK（未配置固定发行签名）。最终小修包括Android续播/访客统计/前台20Hz频谱刷新/统计代次与请求预算衔接，需以最后提交CI结果为准。
