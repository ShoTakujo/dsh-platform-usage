# dsh-platform-usage

在 DSH 的设置页里看 DeepSeek 开放平台的**账号级** Token 活动：52 周热力图，可切每天 / 每周 / 累计总量。

跟常见的用量面板差别在一个口径上。DSH 插件通常读本地会话日志，看到的是 DSH 自己花了多少；这个插件读的是平台账号数据，看到的是**该账号下所有 API Key 合计花了多少**——你在 Claude Code、Hermes、WPS 或者自己写的脚本里调 API，一样会算进来。判断依据是接口返回里每条用量都带 API Key 名字，按 Key 拆开就知道钱花在哪个工具上了。

不是 DeepSeek 官方项目，数据取自官方平台而已。

![平台用量面板](docs/screenshot.png)

## 做到了什么

热力图的每格是一天，颜色按**绝对阈值**分档（1M / 10M / 50M / 100M），不是按相对排名——所以三月和九月的格子可以直接比深浅，不会因为「那个月整体都低」而看起来一样绿。三档切换里，累计总量是那条从年初爬到现在的线。

统计行六个数字：区间内 Token、花费、活跃天数、单日峰值（带日期）、请求次数、账户余额（充值加赠金合并）。

两张拆分表：按 API Key、按模型。前者是这个插件存在的理由，后者能看出 deepseek-v4-pro 和 flash 谁在吃预算。

动效参考 Codex 那个 `/usage` 的手感：格子按列错开 22ms 逐个长出来（切换档位时重播）、统计数字滚动、表格行淡入、悬停格子放大。全部包在 `prefers-reduced-motion` 里，系统关了动效就全禁用，不会有人被动画烦到。

刷新键在标题行右侧，点它跳过缓存重新采集，采完重播一次生长动画。失败时图标变红抖两下，鼠标停上去能看到原因。

几个实现上的决定，值得单独说：

- 面板跑在 iframe 里，同源加载 host 的路由。这样面板的 CSS 和 DSH 互不污染，面板就是一份完整的独立 HTML，改起来不用碰 DSH。
- 界面源码只有一份（`src/panel/template.html`），独立文件版和插件版都由它生成。
- 设置页导航那个 3×3 图标是补丁画出来的，因为 DSH 的 `settings.section` 槽位没有 `icon` 字段，第三方分区一律只能拿到齿轮。

## 不足

先说最要紧的：**这个插件依赖平台的内部接口，不是公开契约。** 开放平台公开的用量相关 API 只有 `GET /user/balance` 一个，返回余额和赠金，没有任何按天、按模型、按 Key 的明细。逐日数据来自平台网页自己调用的 `/api/v0/usage/by_api_key/{amount,cost}`，我用浏览器抓包确认了参数和返回结构。这不是给第三方用的接口，平台改版就可能失效——真失效时面板会显示错误，不会假装还有数据。

几个连带限制：

那个接口**单次最多查 7 天**，所以取满一年要 53 次请求。并发 4 路，冷启动约 2 秒，之后走 10 分钟缓存（命中时 0ms）。想再往前取需要更多请求，目前没做。

接口**不返回 CORS 头**，浏览器不能直连，必须由 DSH 进程代理。这是 `lib/index.js` 存在的原因，代价是这个插件不能只做客户端部分，装完必须重启一次 DSH。

**token 会过期。** 要用平台登录态，失效后余额读不到、数据停更，得重新取一次。这串 token 权限比 API Key 大，只该放在本机。

**拆不到会话。** 平台按 API Key 聚合，所以你知道「Claude Code 花了 643M」，但不知道「上周三那个调试会话花了多少」。要会话级明细得读本地日志，那是另一个口径的插件。

**只在中文区验证过。** 我用 `tz=28800`（东八区）对齐日界，返回里凡是 tz 相关的部分都按 +08:00 处理。其它区域没测过。

**没有自动化测试，只有一次性验证。** 开发过程中跑过：host 侧真实采集 53 周并与平台页面交叉核对（近一年费用 ¥168.55 对平台累计 ¥167.92，差额是当天还没结算的部分）；无头浏览器走真实插件路径渲染（371 格、7 个 Key、4 个模型、三档切换）；客户端 bundle 32 项结构与运行时检查。这些都写成了脚本跑过一次，没有进 CI。

**单机单人开发。** Windows + DSH Desktop 0.2.0-rc.2 验证通过。其它平台、其它 DSH 版本没测。导航图标那个补丁如果碰上宿主 DOM 变化会**静默失效**（图标退回齿轮），但不影响面板本体。

**面板是 iframe，高度写死 1180px。** 窗口特别矮的时候内部会滚动。没做自适应高度测量，因为跨文档测量要 postMessage，收益不大。

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
GET /dsh-official-usage/api/state          逐日数据（按 Key × 模型），10 分钟缓存
GET /dsh-official-usage/api/state?fresh=1  跳过缓存重新采集
GET /dsh-official-usage/api/balance        实时余额
GET /dsh-official-usage/api/refresh        强制刷新，返回摘要
GET /dsh-official-usage/panel.html         面板本体
```

路由前缀是 `dsh-official-usage`（跟包名一致，跟仓库名不一致，历史原因）。

## 仓库结构

```
plugin/                 可直接安装的插件包
  lib/index.js          host：读 token、采集、聚合、注册路由
  lib/dashboard.html    面板本体（iframe 加载）
  client/client.js      浏览器端：注册设置分区 + 导航图标补丁
  cordis.patch.yml      bundle 补丁
src/panel/template.html 面板源模板，独立版和插件版共用
tools/build-panel.mjs   由模板生成 plugin/lib/*
```

改面板：编辑 `src/panel/template.html`，跑 `node tools/build-panel.mjs`。是 link 安装的话刷新浏览器就生效；只有改 host 侧 `plugin/lib/index.js` 才需要重启 DSH。

## 借鉴了谁

界面方向和导航图标方案来自 **[zeng6125-rgb/dsh-usage-heatmap](https://github.com/zeng6125-rgb/dsh-usage-heatmap)**（BSD-3-Clause）。它也是把 DSH 用量画成 GitHub 风格热力图，走本地会话日志口径，跟这个插件正好互补——一个回答「DSH 自己花了多少」，一个回答「这个账号一共花了多少」。三档切换的设计和那个 CSS mask 画导航图标的做法，都是照着它的实现学的；`settings.section` 没有 `icon` 字段、第三方分区只能拿齿轮这件事，也是它实测出来的。

热力图形态来自 GitHub 的贡献图，「Token 活动」这个标题和整体呈现参考了 Codex 的 `/usage`。

## License

[MIT](LICENSE)
