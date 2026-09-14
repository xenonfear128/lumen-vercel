# Lumen 交接留言板

最后更新：2026-09-14（最新修复与验证见文末；开始工作前先读，完成后更新）。

## 当前状态

根项目与 Vercel 子工作区的公共源代码已同步，登录、播放竞态、错误提示、统计持久化和统计页窄屏布局已修复，并新增行为回归测试。最新播放列表持久化已同步两边源码，根 dist 已重建，已部署到 https://lumen.rupa.best 。release 中 Windows/Linux 包仍是此前登录修复版，尚未重新打入本次持久化更新。

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
