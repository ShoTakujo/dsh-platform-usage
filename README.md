# dsh-platform-usage

在 DSH 的设置页里看 DeepSeek 开放平台的**账号级** Token 活动：52 周热力图，可切每天 / 每周 / 累计总量。

跟常见的用量面板差别在一个口径上。DSH 插件通常读本地会话日志，看到的是 DSH 自己花了多少；这个插件读的是平台账号数据，看到的是**该账号下所有 API Key 合计花了多少**——你在 Claude Code、Hermes、WPS 或者自己写的脚本里调 API，一样会算进来。判断依据是接口返回里每条用量都带 API Key 名字，按 Key 拆开就知道钱花在哪个工具上了。

不是 DeepSeek 官方项目，数据取自官方平台而已。

![平台用量面板](docs/screenshot.png)

## 当前状态

**能用。** 数据采集、展示、交互、主题跟随、壁纸玻璃都通了。

其中一条曾经阻塞很久的问题已经定位并修掉：**深色模式下某些环境仍然是白底**——真凶不是主题判定，是面板自己把背景刷成了 `transparent`，而它当时活在 iframe 里（iframe 自有画布，默认白色）。现在面板改跑在 **Shadow DOM** 里，背景改成"不刷"，白底从结构上不可能再出现。

## 做到了什么

**数据**

- 官方接口按 API Key × 模型逐日取回，7 天一个窗口、并发 4 路、宿主侧缓存 10 分钟
- 日历口径 = **东八区**（平台自己的口径），采集窗口按东八区午夜对齐
- 面板开着时**自己保鲜**：每 5 分钟看一次，数据超过 10 分钟就让宿主重采 —— 新的一天出现新格子、今天的绿色自己跟上
- 默认停在**最新（最右）**那一端；切换档位与刷新不会打断你自己滚到的位置

**面板**

- 六档热力图：`0` 灰 ｜ `<5M` ｜ `5–20M` ｜ `20–60M` ｜ `60–120M` ｜ `120–200M` ｜ `≥200M`
  绝对阈值（跨月可比），两套等距绿梯（暗色越亮越多 / 亮色越深越多），相邻档 OKLab ΔE ≥ 0.079
- 悬停提示严格三行：`10月3日` / `3.51 亿 token` / `花费 11.97 元`；零用量的过去日子也有提示（两行：日期 + `0 token`）；周 / 累计视图额外补一行说明格子代表什么
- **Shadow DOM 面板**（不再用 iframe）：CSS 与宿主互相隔离，但设计令牌、字体、`color-scheme` 正常继承
- 背景**不刷底色** → 直接透出设置窗口自己的材质；壁纸激活时壁纸从面板底下透出来，卡片的 `backdrop-filter` 糊的是真壁纸
- 主题跟随就一行判断：`body[data-ds-dark-theme]`（DSH 自己的标记，宿主 CSS 也用它）
- 设置页导航行换成 3×3 热力图图标（宿主没给 icon 字段，靠标记 + CSS mask 补）

**外观可以免重启**

面板的 CSS/HTML 另外出一份 `panel-assets.json`，挂载时以 `no-store` 拉一次，版本对得上就整块重铺 —— **改配色 / 间距 / 文案不用重启 DSH**，关掉设置再打开即可。脚本仍走内嵌（运行时不做 eval），所以改结构或逻辑仍需重启。

## 已知限制

- **token 会过期。** 失效后余额读不到、数据停更，得重新取一次（见「装」）。这串 token 权限比 API Key 大，只该放在本机。
- **拆不到会话。** 平台按 API Key 聚合，所以你知道「Claude Code 花了 643M」，但不知道「上周三那个调试会话花了多少」。
- **缓存命中 / 新增、请求次数在面板里看不到。** 悬浮提示按"只要三行"的规格砍掉了这两项（表格里也没有）；想看只能改回去。
- **档位是绝对阈值，不是相对排名。** 用量长期增长后固定阈值会逐渐"顶格"，届时要重新定边界。
- **导航图标补丁会静默失效。** 宿主 DOM 变了图标就退回齿轮，不影响面板本体。
- **单机单人开发。** Windows + DSH Desktop 0.2.0-rc.2 验证通过，其它平台和版本没测。

## 架构（为什么是现在这样）

```
宿主半   plugin/lib/index.js      采集 + 四个路由 + panel-assets.json
客户端半 plugin/client/client.js  Shadow DOM 挂载（由 tools/build-panel.mjs 生成，内嵌面板产物）
面板     src/panel/template.html  CSS + 结构 + 面板脚本；独立打开时也是一个完整页面
构建     tools/build-panel.mjs    同一份模板 → dashboard.html / dashboard.js / styles.css / client.js / panel-assets.json
测试     tools/test-client.mjs    77 项：文本守卫、工厂执行、Shadow DOM 挂载、取数、保鲜、资产重铺
```

**为什么是 Shadow DOM 而不是 iframe**

- iframe 是独立文档：拿不到宿主的 CSS 变量、字体、`color-scheme`；面板里的 `backdrop-filter` 只能糊自己文档里的东西（壁纸玻璃失效）；画布默认白色（`background:transparent` 就等于白底）。
- Shadow DOM 保留隔离（外面的规则进不来、里面的出不去），但自定义属性与可继承属性照常继承 —— 底色、文字色、玻璃配方、字体全部跟着宿主走，`backdrop-filter` 糊的是真壁纸。

**为什么采集要按东八区对齐**

实测（2026-10-04）：平台接口按**查询起点所在的那个午夜**分日——起点给 `2026-09-30T16:00Z`（东八区 10-01 00:00）就返回东八区的日桶（戳在 16:00Z），起点给 UTC 午夜就返回 UTC 的日桶。请求里的 `tz` 参数在这台账号上实测**不影响分桶**（`tz=28800` 与 `tz=0` 逐桶数值相同），真正起作用的是窗口对齐方式。

## 开发过程中踩过的坑

这几条不是理论风险，是真踩进去过的：

**1. 模板字符串会吃掉正则转义。** 主题判定脚本原本写在 `build-panel.mjs` 的模板字符串里，`/rgba?\(\s*(\d+)/` 生成到产物里变成 `/rgba?(s*(d+)/`。现在这段脚本单独放 `src/panel/theme-boot.js`，按文件读入，且构建时对产物做**字面量断言**（不是正则断言）。

**2. `rgba(0,0,0,0)` 会被算成纯黑。** 全透明颜色的亮度是 0，"没测到"被当成"测到黑色"。现在 alpha ≤ 0.05 一律视为没测到。

**3. 白底的真凶是"自己刷了一层"，不是"判定错了"。** 面板曾在插件模式下把 `html,body` 刷成 `background:transparent`，盖掉了 `body{background:var(--bg)}`；iframe 画布默认白色，于是暗色主题配白底。前几轮一直在修"怎么判断主题"（判定其实一直是对的：诊断里 `decided` 始终是 `dark`），没人去看"面板自己画的是什么背景"。

**4. `toISOString()` + 本地午夜 = 整张表错位一天。** 网格用 `new Date(iso+'T00:00:00')`（本地零点）再 `toISOString()`（UTC）取日期，东八区下每天都退一天，于是「周日」那一行显示的是周六的日期。现在网格与日期一律 UTC 语义，与宿主 `dayKey` 同一套。

**5. 档位越界会静默变成"没数据"色。** `level()` 对 ≥1 亿返回 5，而 CSS 只有 `.c.l1 ~ .c.l4` —— 产量最高的那几天挂了个不存在的 class、回落成 `--l0`（没数据那档），看起来就是"今天和昨天的绿色没出现"。现在 `N 个边界 ⇒ N+1 档`，顶格恰好是第 6 档。

**6. 悬停提示被祖先的 `backdrop-filter` 劫持。** 设置窗口 + 壁纸玻璃让 `position:fixed` 的包含块不再是视口，tip 按祖先的内容坐标摆放、随滚动越偏越远，最后被 `overflow` 裁掉——表现是"鼠标悬停什么都不显示"。现在 tip 挂进 **top layer**（`popover="manual"`），实测偏差从 (54, −57) 变成准确的 (+14, +14)。

**7. 媒体查询判的是视口宽度，不是容器宽度。** 两张拆分表原本 `@media(min-width:900px)` 时并排；DSH 把面板塞进七八百像素的内容列，而视口很宽——媒体查询照样命中，右边那张表被容器裁掉。现在一律上下排（宽屏要并排得用容器查询 `@container`）。

**8. 滚动容器的内边距不是装饰。** 悬停会把格子放大到 1.55× 并描一圈 1.5px 的环，绘制范围比原格子外扩约 5.9px；而滚动容器的裁剪边就是它自己的 padding box。原来只留 2px，最下面一行的放大环被横向滚动条那一条切掉。

**9. 用 PowerShell 写 JSON 会带 BOM。** `Set-Content -Encoding UTF8` 给 `package.json` 写进了 `ef bb bf`；Node 解析带 BOM 的 JSON 直接抛错，加载器读不到清单 → **整个插件被静默跳过**（宿主和客户端两半都没起来），表现是"装了但什么都没生效"。现在所有 JSON 都用 Node 写（`JSON.stringify` + `utf8`），并另有 BOM 体检。

**最该记住的一条**：上面这些坑之所以反复出现，是因为**编造的测试环境比真实环境"干净"**——测试宿主把主题变量放在根元素、用 `rgb()` 写法、快照用顶层字段、用假 DOM，每一条都和真实宿主不一样，于是"测试通过但真机无效"。**照真实结构搭测试**（Shadow DOM、真壁纸玻璃、真滚动容器、真玻璃祖先）比多写几个断言有用得多。

## 装

```sh
dsh plugin --profile desktop add link:<本仓库路径>/plugin
```

装完重启一次 DSH，设置里会多出「平台用量」。web profile 把 `desktop` 换成 `web`。

需要一个平台 token。登录 <https://platform.deepseek.com>，按 F12 打开 **Console**（中文界面叫「控制台」；如果打开的是 Node.js 控制台，里面没有 `localStorage`，会一直拿不到东西），执行：

```js
JSON.parse(localStorage.getItem('userToken')).value
```

把输出写进 `~/.dsh/.credentials.yaml`：

```yaml
  DEEPSEEK_PLATFORM_TOKEN: 粘贴到这里
```

环境变量 `DEEPSEEK_PLATFORM_TOKEN` 优先级更高，也认。

## 本机路由

```
GET /dsh-official-usage/api/state            逐日数据（按 Key × 模型），10 分钟缓存
GET /dsh-official-usage/api/state?fresh=1    跳过缓存重新采集
GET /dsh-official-usage/api/balance          实时余额
GET /dsh-official-usage/api/refresh          强制重采（面板右上角刷新键用的就是它）
GET /dsh-official-usage/panel.html           独立页面版（iframe 时代留下的，保留作调试入口）
GET /dsh-official-usage/panel-assets.json    运行时资产：CSS/HTML + 两个版本号
```

## 仓库结构

```
plugin/                 可直接安装的 DSH 插件包
  client/client.js        客户端半（由 tools/build-panel.mjs 生成，勿手改）
  lib/index.js            宿主半：采集 + 路由
  lib/dashboard.html      独立页面版（同一份模板 + 主题判定脚本）
  lib/dashboard.js        面板脚本（便于阅读）
  lib/styles.css          面板样式（便于阅读）
  lib/panel-assets.json   运行时资产：CSS/HTML + cssRev/jsRev
  cordis.patch.yml        bundle patch：把自己插进 profile 的层栈
src/panel/template.html   面板的唯一真源（CSS + 结构 + 面板脚本）
src/panel/theme-boot.js   独立页面用的主题判定脚本
src/client/client.src.js  客户端半的唯一真源
tools/build-panel.mjs     构建：模板 → 上面那些产物
tools/test-client.mjs     77 项检查
```

## 验证方式

```sh
node tools/build-panel.mjs     # 构建（内含产物断言：主题脚本、转义、根节点、版本号）
node tools/test-client.mjs     # 77 项：文本守卫 + 工厂执行 + 挂载 + 取数 + 保鲜 + 资产重铺
```

真机验证走过的路子：无头 Chromium 连 CDP，把真实产物挂进"像 DSH 那样"的宿主（令牌挂在 `body`、`body[data-ds-dark-theme]`、玻璃祖先、真滚动容器、真壁纸条纹），按像素与计算样式判定——面板里的 `backdrop-filter` 是否糊到壁纸、tip 位置是否准确、格子放大环是否被裁、卡片是否透出窗口材质，都是这么量出来的。

## 借鉴了谁

- 视觉与交互对标 **Codex 的 `/usage`「Token 活动」面板**（52 周热力图、每天/每周/累计、悬停看当天明细、没有图例）
- 玻璃与壁纸适配参照 **dsh-plugin-wallpaper-engine**（`--we-*` 令牌、`--dsh-alias-bg-layer-*` 的玻璃配方）
- "原生分区该怎么活"参照 **dshmarket**（不刷底色、直接透出窗口材质）
- 导航图标补丁的做法来自 **dsh-usage-heatmap** 的实测方案

## License

MIT
