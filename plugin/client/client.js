/**
 * dsh-official-usage —— client 侧（设置页「平台用量」分区）
 *
 * ⚠️ 这个文件是**源文件**：`plugin/client/client.js` 由 tools/build-panel.mjs 生成，
 *    不要把改动写进产物里（会在下一次构建被覆盖）。
 *
 * 面板怎么进来的：**Shadow DOM**，不是 iframe。
 *   早先用 iframe，是因为面板有一整套自己的 CSS，怕污染宿主。代价是：
 *     · iframe 是独立文档 → 拿不到宿主的 CSS 变量、字体、color-scheme；
 *     · 面板里的 backdrop-filter 只能糊自己文档里的东西 → 壁纸插件的玻璃在面板里失效；
 *     · 画布默认是白的 → 面板背景一旦透明就是白底（2026-10-03 那个 bug 的根源）。
 *   Shadow DOM 把这两件事同时解决：CSS 依旧完全隔离（外面的规则进不来、里面的出不去），
 *   但**自定义属性与可继承属性照常继承**，于是：
 *     · 背景直接用宿主的 --dsw-alias-bg-base —— 壁纸插件激活时它自己就是 transparent，
 *       壁纸于是透进面板；
 *     · 卡片的 backdrop-filter 糊的就是真壁纸（同一个文档，同一套 backdrop root）；
 *     · 壁纸插件改写过的 --we-* / --dsw-alias-label-* 也直接可用，无需转发。
 *   主题判断也随之收敛成一行：DSH 自己的标记 body[data-ds-dark-theme] 就是答案
 *   （ui-layout 的 theme-presenter 维护它，宿主 CSS 也用它），不需要再猜。
 *
 * 外观为什么能免重启：CSS/HTML 另外出一份 lib/panel-assets.json，挂载时 no-store 拉一次，
 *   版本对得上就整块重铺（脚本仍是内嵌的那份，契约一致）；**只有脚本也变了才需要重启**。
 */
window.__ModuleLoader__.load({
	id: 'dsh-official-usage',
	factory: (require) => {
		var React = require('react')
		var h = React.createElement

		var PLUGIN_ID = 'dsh-official-usage'
		var SECTION_LABEL = '平台用量'
		var STATE_URL = '/dsh-official-usage/api/state'
		var REFRESH_URL = '/dsh-official-usage/api/refresh'
		var PANEL_ASSETS_URL = '/dsh-official-usage/panel-assets.json'

		// ------------------------------------------------------------------
		// 构建时注入：面板样式 / 面板结构 / 面板脚本 + 两个版本号
		//   CSS 已由构建脚本改成 shadow 版（:root → :host 等）
		//   JS  已由构建脚本作用域化（id 查询走面板根、监听器挂在面板根上）
		// 都是纯字面量，运行时不做字符串拼接，也不用 eval。
		// ------------------------------------------------------------------
		var PANEL_CSS = "\n  :host{\n    --bg:#f7f8fb; --card:#ffffff; --line:#e8e6e1; --text:#1f2328; --dim:#6b7280;\n    /* 六档绿梯（亮色）：越用越多越深。按 OKLab 等距排的，相邻档 ΔE ≥0.08，13px 上也分得清 */\n    --l0:#eceff1; --l1:#cdeab4; --l2:#a5dc8c; --l3:#6ec96a; --l4:#3fae52; --l5:#238b41; --l6:#14622f;\n    --accent:#4d6bfe;\n    /* 玻璃：卡片与浮层共用的乳白底 + 边框 */\n    --glass:rgba(255,255,255,.58);\n    --glass-strong:rgba(255,255,255,.76);\n    --glass-line:rgba(255,255,255,.72);\n    --glass-stroke:rgba(17,24,39,.07);\n    --glass-shadow:0 6px 26px rgba(15,23,42,.09), 0 1px 3px rgba(15,23,42,.05);\n  }\n  /* 暗色变量抽成一份，两个入口共用：\n       · 独立打开 → 跟随系统 prefers-color-scheme\n       · 插件面板 → 靠 <html data-theme=\"dark\"> 显式指定（DSH 的主题是应用内设置，\n         不一定等于系统主题；早先只认媒体查询，就会出现「DSH 亮色、面板暗色」的错配） */\n  :host([data-theme=\"dark\"]){\n    --bg:#16181c; --card:#242629; --line:#34383d; --text:#e8eaed; --dim:#9aa0a6;\n    /* 六档绿梯（暗色）：越用越多越亮，OKLab 等距，相邻档 ΔE ≥0.08 */\n    --l0:#2d3134; --l1:#14512f; --l2:#1e6b3d; --l3:#2a8a4a; --l4:#3cb45c; --l5:#57d873; --l6:#8bf59a;\n    --glass:rgba(38,41,46,.55); --glass-strong:rgba(44,47,53,.78);\n    --glass-line:rgba(255,255,255,.08); --glass-stroke:rgba(255,255,255,.10);\n    --glass-shadow:0 8px 30px rgba(0,0,0,.42), 0 1px 3px rgba(0,0,0,.3);\n  }\n  /* 没被显式指定主题时（独立打开），跟随系统 */\n  @media (prefers-color-scheme: dark){\n    :host(:not([data-theme=\"light\"])){\n      --bg:#16181c; --card:#242629; --line:#34383d; --text:#e8eaed; --dim:#9aa0a6;\n      --l0:#2d3134; --l1:#14512f; --l2:#1e6b3d; --l3:#2a8a4a; --l4:#3cb45c; --l5:#57d873; --l6:#8bf59a;\n      --glass:rgba(38,41,46,.55); --glass-strong:rgba(44,47,53,.78);\n      --glass-line:rgba(255,255,255,.08); --glass-stroke:rgba(255,255,255,.10);\n      --glass-shadow:0 8px 30px rgba(0,0,0,.42), 0 1px 3px rgba(0,0,0,.3);\n    }\n  }\n  *{box-sizing:border-box}\n  /* shadow 里没有 html/body：宿主元素自己就是面板的画布。\n     ⚠️ 底色**不刷**（transparent）：面板现在活在宿主文档里，不刷底色就会直接透出设置窗口自己的材质\n     —— 和「插件市场」那种原生分区一模一样，壁纸玻璃、窗口底色都自动对上。\n     早先 iframe 版本不能透明，是因为 iframe 自有画布、默认是白的（白底 bug 的根源）；\n     换成 shadow DOM 之后那个前提已经不成立，反而刷一层 --dsw-alias-bg-base 会在玻璃窗口里\n     露出一块颜色不同的实心方块（2026-10-05 用户报的）。\n     文字色仍然优先跟宿主（壁纸插件为了可读性会改写 --dsw-alias-label-primary）。 */\n  :host{display:block;background:transparent;\n        color:var(--dsw-alias-label-primary,var(--text));\n        font:14px/1.5 -apple-system,\"Segoe UI\",\"Microsoft YaHei\",system-ui,sans-serif;}\n  /* 不支援 backdrop-filter 时退化成实色，别让文字失去对比 */\n  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))){\n    .card,.modes,#tip{background:var(--card) !important}\n  }\n  .wrap{position:relative;z-index:1;max-width:1180px;margin:0 auto;padding:28px 22px 60px}\n  header{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:14px}\n  h1{font-size:19px;font-weight:650;margin:0}\n  .headRight{display:flex;align-items:center;gap:10px}\n  .sub{color:var(--dim);font-size:12.5px}\n  .sub b{color:var(--text);font-weight:600}\n  /* 视图切换 + 刷新 = 同一个胶囊：外框只有一层，靠分隔线分区 */\n  .modes{display:flex;align-items:center;gap:2px;padding:3px;\n         background:var(--glass);border:1px solid var(--glass-line);border-radius:11px;\n         backdrop-filter:blur(16px) saturate(165%);-webkit-backdrop-filter:blur(16px) saturate(165%);\n         box-shadow:var(--glass-shadow)}\n  .modes button{border:0;background:transparent;color:var(--dim);font:inherit;font-size:13px;\n                padding:5px 14px;border-radius:7px;cursor:pointer}\n  .modes button.on{background:var(--accent);color:#fff}\n  /* 只留图标的刷新键 */\n  .modes .refresh{display:inline-flex;align-items:center;justify-content:center;\n                  padding:5px 10px;margin-right:3px;color:var(--dim);\n                  border-right:1px solid var(--line);border-radius:7px 0 0 7px;\n                  transition:color .15s ease,background .15s ease,transform .12s ease}\n  .modes .refresh svg{display:block}\n  .modes .refresh:hover{color:var(--text);background:rgba(127,127,127,.08)}\n  .modes .refresh:active{transform:scale(.92)}\n  .modes .refresh[disabled]{opacity:.6;cursor:default}\n  .modes .refresh.busy svg{animation:spin .8s linear infinite}\n  @keyframes spin{to{transform:rotate(360deg)}}\n  @keyframes errPulse{0%,100%{transform:translateX(0)}25%{transform:translateX(-2px)}75%{transform:translateX(2px)}}\n  .modes .refresh.err{color:#d92d20;animation:errPulse .32s ease 2}\n  .card{background:var(--glass);border:1px solid var(--glass-line);border-radius:16px;\n        padding:18px 18px 14px;margin-top:16px;\n        backdrop-filter:blur(20px) saturate(170%);-webkit-backdrop-filter:blur(20px) saturate(170%);\n        box-shadow:var(--glass-shadow)}\n  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px}\n  .stat .k{color:var(--dim);font-size:12px}\n  .stat .v{font-size:22px;font-weight:660;letter-spacing:-.4px;margin-top:2px}\n  .stat .v small{font-size:13px;font-weight:500;color:var(--dim);margin-left:3px}\n  .gridbox{overflow-x:auto;overflow-y:hidden;\n           /* 内边距不是装饰：悬停会把格子放大到 1.55×、再描一圈 1.5px 的环，\n              整个绘制范围比原格子外扩约 5.9px；而滚动容器的裁剪边就是它自己的 padding box。\n              不留这点余量，最下面一行的放大环会被横向滚动条那一条切掉（2026-10-04 用户报的\n              「格子边框边缘被裁」）。\n              ⚠️ 横向余量**不能**留在这里：Chromium 把滚动容器的尾部 padding 算进可滚区域，\n              滚到底时内容右边缘正好顶到裁剪边，这点 padding 会被\"吃\"掉——真机上表现为\n              拉到最右时最后一列仍被切（2026-10-06 用户报的）。所以横向余量挪到内容自身的\n              .cols 上（见下），它属于内容的盒子，滚到底一定留得下。 */\n           padding:0 0 8px;\n           /* 滚动条：轨道必须透明。UA 默认用系统 Canvas 色画轨道（暗色下纯黑、亮色下纯白），\n              面板背景在壁纸模式下是透明的，于是这条固定底色会横在热力图下面很扎眼。\n              滑块用中性半透明灰，压在深底/浅底/壁纸上都看得见、也不抢戏。 */\n           scrollbar-width:thin;scrollbar-color:rgba(127,127,127,.55) transparent}\n  .gridbox::-webkit-scrollbar{height:10px;width:10px}\n  .gridbox::-webkit-scrollbar-track,\n  .gridbox::-webkit-scrollbar-corner{background:transparent}\n  .gridbox::-webkit-scrollbar-thumb{background:rgba(127,127,127,.5);border-radius:6px}\n  .gridbox::-webkit-scrollbar-thumb:hover{background:rgba(127,127,127,.72)}\n  /* 月份轴：绝对定位，每个标签的 left = 列索引 × 17px（13 格子 + 4 间隙），\n     和格子的几何完全一致。以前是一排 span（宽 14px、有文字的改 auto）+ gap:4px，\n     每个单元 18px 而格子是 17px，53 列累计漂 53px，到 9 月能偏出 5 个格子。 */\n  .months{position:relative;height:14px;margin:0 0 5px 27px}\n  .months span{position:absolute;top:0;font-size:11px;color:var(--dim);white-space:nowrap}\n  .gridrow{display:flex;align-items:flex-start}\n  .wd{display:flex;flex-direction:column;gap:4px;width:27px;flex:0 0 27px}\n  .wd span{height:13px;font-size:10px;color:var(--dim);line-height:13px}\n  /* 横向余量（8px）放在内容这一层：属于 .cols 自己的盒子，会被算进可滚内容，\n     滚到最右时最后一列距离裁剪边仍有 8px —— 放大环（外扩 5.9px）也就完整了。\n     如果放在滚动容器（.gridbox）的 padding 上，滚到底会被吃掉（真机实测差 6px）。 */\n  .cols{display:flex;gap:4px;padding-right:8px}\n  .col{display:flex;flex-direction:column;gap:4px}\n  .c{width:13px;height:13px;border-radius:3px;background:var(--l0)}\n  .c[data-tip]{cursor:pointer}\n  /* 六档：只有 l1..l6。以前这里有 l1..l4 + 一条 \"l5 兜底成 l4\" —— 档数一改就把 l5 压掉了，\n     所以那条兜底已经删掉：现在 level() 恰好返回 0..6，越界不再可能（顶格返回 LV.length = 6）。 */\n  .c.l1{background:var(--l1)} .c.l2{background:var(--l2)} .c.l3{background:var(--l3)}\n  .c.l4{background:var(--l4)} .c.l5{background:var(--l5)} .c.l6{background:var(--l6)}\n  /* 图例已按用户要求撤掉（\"神秘一点\"）：档位含义只靠悬停看。\n     ⚠️ 但 .legend 的样式先留着 —— 运行时装资产那条路只换 CSS 不换 HTML，\n     正在跑的旧客户端手里还有那份带图例的旧结构，样式删了它会散成一排裸色块。\n     下一次重启后这份 HTML 就没人用了，届时可以连同这两条规则一起删。 */\n  .legend{display:flex;align-items:center;gap:5px;justify-content:flex-end;color:var(--dim);font-size:11.5px;margin-top:10px}\n  .legend i{width:13px;height:13px;border-radius:3px;display:inline-block}\n  /* 热力图卡片：图例没了，底部留白跟着收上来（原来 14px 是给图例垫的），\n     现在上下都是 18px（10px 卡片内边距 + 8px 网格容器内边距），视觉对称 */\n  .gridcard{padding-bottom:10px}\n  table{width:100%;border-collapse:collapse;font-size:13px}\n  th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap}\n  /* 第一列是名字（API Key / 模型），长名字允许换行——数字列保持不换行对齐 */\n  th:first-child,td:first-child{white-space:normal;overflow-wrap:anywhere}\n  th{color:var(--dim);font-weight:500;font-size:12px}\n  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}\n  .bar{height:7px;border-radius:4px;background:var(--accent);opacity:.75;display:inline-block;vertical-align:middle}\n  .two{display:grid;grid-template-columns:1fr;gap:16px}\n  .two>*{min-width:0}          /* 允许子项收缩，别再顶破容器 */\n  /* 两张拆分表**一律上下排**（先「按 API Key」，再「按模型」）。\n     早先写的是 @media(min-width:900px) 时并排两列 —— 那个 900px 判的是**视口宽度**，\n     而面板在 DSH 设置页里被塞进内容列（列宽比视口窄得多，七八百像素），媒体查询照样命中，\n     于是两张表并排、右边那张被容器裁掉（2026-10-04 用户报的）。\n     表格单元格是 white-space:nowrap，并排所需的最小宽度远大于内容列 ⇒ 只能上下排。\n     （将来若真想在宽屏并排，正确做法是容器查询 @container，而不是媒体查询。） */\n  h2{font-size:14px;font-weight:600;margin:0 0 10px}\n  /* 悬浮提示：换成乳白玻璃（原来是一块纯黑） */\n  #tip{position:fixed;z-index:99;pointer-events:none;font-size:12px;\n       /* popover 进 top layer 时 UA 会塞进 inset:0 + margin:auto，得清掉 */\n       inset:auto;margin:0;\n       padding:9px 12px;border-radius:12px;opacity:0;transition:opacity .1s;max-width:300px;line-height:1.55;\n       background:var(--glass-strong);color:var(--text);\n       border:1px solid var(--glass-line);\n       backdrop-filter:blur(22px) saturate(180%);-webkit-backdrop-filter:blur(22px) saturate(180%);\n       box-shadow:0 12px 34px rgba(15,23,42,.16), 0 2px 8px rgba(15,23,42,.08)}\n  #tip b{font-weight:650}\n  #tip.on{opacity:1}\n  .note{color:var(--dim);font-size:12px;margin-top:12px}\n  .note code{background:rgba(127,127,127,.14);padding:1px 5px;border-radius:4px}\n\n  /* ---------- 动效（对标 Codex：草地逐列生长 + 数字滚动） ---------- */\n  @keyframes cellIn{\n    0%  {transform:scale(.35) translateY(3px);opacity:0;filter:brightness(1.7)}\n    55% {transform:scale(1.1)  translateY(0);  opacity:1;filter:brightness(1.22)}\n    100%{transform:scale(1)    translateY(0);  opacity:1;filter:brightness(1)}\n  }\n  .cols.animate .c{animation:cellIn .46s cubic-bezier(.22,.72,.28,1.02) both}\n  .cols.animate .col:nth-child(1) .c{animation-delay:0s}\n  .cols.animate .col:nth-child(2) .c{animation-delay:.022s}\n  .cols.animate .col:nth-child(3) .c{animation-delay:.044s}\n  .cols.animate .col:nth-child(4) .c{animation-delay:.066s}\n  .cols.animate .col:nth-child(5) .c{animation-delay:.088s}\n  .cols.animate .col:nth-child(6) .c{animation-delay:.11s}\n  .cols.animate .col:nth-child(7) .c{animation-delay:.132s}\n  .cols.animate .col:nth-child(8) .c{animation-delay:.154s}\n  .cols.animate .col:nth-child(9) .c{animation-delay:.176s}\n  .cols.animate .col:nth-child(10) .c{animation-delay:.198s}\n  .cols.animate .col:nth-child(11) .c{animation-delay:.22s}\n  .cols.animate .col:nth-child(12) .c{animation-delay:.242s}\n  .cols.animate .col:nth-child(13) .c{animation-delay:.264s}\n  .cols.animate .col:nth-child(14) .c{animation-delay:.286s}\n  .cols.animate .col:nth-child(15) .c{animation-delay:.308s}\n  .cols.animate .col:nth-child(16) .c{animation-delay:.33s}\n  .cols.animate .col:nth-child(17) .c{animation-delay:.352s}\n  .cols.animate .col:nth-child(18) .c{animation-delay:.374s}\n  .cols.animate .col:nth-child(19) .c{animation-delay:.396s}\n  .cols.animate .col:nth-child(20) .c{animation-delay:.418s}\n  .cols.animate .col:nth-child(21) .c{animation-delay:.44s}\n  .cols.animate .col:nth-child(22) .c{animation-delay:.462s}\n  .cols.animate .col:nth-child(23) .c{animation-delay:.484s}\n  .cols.animate .col:nth-child(24) .c{animation-delay:.506s}\n  .cols.animate .col:nth-child(25) .c{animation-delay:.528s}\n  .cols.animate .col:nth-child(26) .c{animation-delay:.55s}\n  .cols.animate .col:nth-child(27) .c{animation-delay:.572s}\n  .cols.animate .col:nth-child(28) .c{animation-delay:.594s}\n  .cols.animate .col:nth-child(29) .c{animation-delay:.616s}\n  .cols.animate .col:nth-child(30) .c{animation-delay:.638s}\n  .cols.animate .col:nth-child(31) .c{animation-delay:.66s}\n  .cols.animate .col:nth-child(32) .c{animation-delay:.682s}\n  .cols.animate .col:nth-child(33) .c{animation-delay:.704s}\n  .cols.animate .col:nth-child(34) .c{animation-delay:.726s}\n  .cols.animate .col:nth-child(35) .c{animation-delay:.748s}\n  .cols.animate .col:nth-child(36) .c{animation-delay:.77s}\n  .cols.animate .col:nth-child(37) .c{animation-delay:.792s}\n  .cols.animate .col:nth-child(38) .c{animation-delay:.814s}\n  .cols.animate .col:nth-child(39) .c{animation-delay:.836s}\n  .cols.animate .col:nth-child(40) .c{animation-delay:.858s}\n  .cols.animate .col:nth-child(41) .c{animation-delay:.88s}\n  .cols.animate .col:nth-child(42) .c{animation-delay:.902s}\n  .cols.animate .col:nth-child(43) .c{animation-delay:.924s}\n  .cols.animate .col:nth-child(44) .c{animation-delay:.946s}\n  .cols.animate .col:nth-child(45) .c{animation-delay:.968s}\n  .cols.animate .col:nth-child(46) .c{animation-delay:.99s}\n  .cols.animate .col:nth-child(47) .c{animation-delay:1.012s}\n  .cols.animate .col:nth-child(48) .c{animation-delay:1.034s}\n  .cols.animate .col:nth-child(49) .c{animation-delay:1.056s}\n  .cols.animate .col:nth-child(50) .c{animation-delay:1.078s}\n  .cols.animate .col:nth-child(51) .c{animation-delay:1.1s}\n  .cols.animate .col:nth-child(52) .c{animation-delay:1.122s}\n  .cols.animate .col:nth-child(53) .c{animation-delay:1.144s}\n\n  .c{transition:transform .12s ease,box-shadow .12s ease}\n  .c:hover{transform:scale(1.55);box-shadow:0 0 0 1.5px var(--card),0 1px 5px rgba(0,0,0,.18);position:relative;z-index:3}\n  .c:active{transform:scale(1.25)}\n\n  @keyframes statIn{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}\n  .stat{animation:statIn .42s ease both}\n  .stat:nth-child(1){animation-delay:.02s} .stat:nth-child(2){animation-delay:.06s}\n  .stat:nth-child(3){animation-delay:.1s}  .stat:nth-child(4){animation-delay:.14s}\n  .stat:nth-child(5){animation-delay:.18s} .stat:nth-child(6){animation-delay:.22s}\n  .stat .v{font-variant-numeric:tabular-nums}\n\n  @keyframes rowIn{from{opacity:0;transform:translateX(-7px)}to{opacity:1;transform:none}}\n  tbody tr{animation:rowIn .38s ease both}\n  tbody tr:nth-child(1){animation-delay:.04s} tbody tr:nth-child(2){animation-delay:.09s}\n  tbody tr:nth-child(3){animation-delay:.14s} tbody tr:nth-child(4){animation-delay:.19s}\n  tbody tr:nth-child(5){animation-delay:.24s} tbody tr:nth-child(6){animation-delay:.29s}\n  tbody tr:nth-child(7){animation-delay:.34s} tbody tr:nth-child(8){animation-delay:.39s}\n  .bar{transform-origin:left center;animation:barIn .75s cubic-bezier(.2,.8,.25,1) both}\n  @keyframes barIn{from{transform:scaleX(0);opacity:.25}to{transform:scaleX(1);opacity:.75}}\n\n  .modes button{transition:background .18s ease,color .18s ease,transform .12s ease}\n  .modes button.on{animation:pill .28s ease}\n  @keyframes pill{0%{transform:scale(.93)}60%{transform:scale(1.035)}100%{transform:scale(1)}}\n  @keyframes tipIn{from{opacity:0;transform:translateY(4px) scale(.97)}to{opacity:.96;transform:none}}\n  #tip.on{opacity:.96;animation:tipIn .13s ease}\n  .card{transition:box-shadow .2s ease}\n\n  @media (prefers-reduced-motion: reduce){\n    .cols.animate .c,.stat,tbody tr,.bar,#tip.on,.modes button.on{animation:none !important}\n    .c:hover{transform:none}\n  }\n\n  /* 内嵌（shadow）模式：宽度交给宿主容器 */\n  .wrap{max-width:none;padding:2px 2px 10px}\n  /* 壁纸插件在跑时（客户端把 body[data-we-wallpaper] 镜像到宿主元素上）：\n     卡片 / 胶囊 / 浮层改用宿主那套玻璃面 —— --dsw-alias-bg-layer-* 在壁纸激活时\n     就是「主题底色压可读性下限 + 玻璃色按玻璃透明度混合」的配方，\n     于是面板与设置窗口里其它玻璃同一配方，壁纸也从面板底下透出来。 */\n  :host([data-we]) .card,\n  :host([data-we]) .modes,\n  :host([data-we]) #tip{background:var(--dsw-alias-bg-layer-1,var(--glass))}\n  :host([data-we]){--text:var(--dsw-alias-label-primary,var(--text));--dim:var(--dsw-alias-label-secondary,var(--dim));--line:var(--dsw-alias-border-l1,var(--line))}\n"
		var PANEL_HTML = "<div id=\"official-usage-root\" class=\"ou-root\"><div class=\"wrap\">\n  <header>\n    <div>\n      <h1>Token 活动</h1>\n    </div>\n    <div class=\"headRight\">\n      <div class=\"modes\" id=\"modes\">\n        <button id=\"refresh\" class=\"refresh\" title=\"刷新\" aria-label=\"刷新\">\n          <svg viewBox=\"0 0 16 16\" width=\"13\" height=\"13\" aria-hidden=\"true\"><path fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" d=\"M13.5 8a5.5 5.5 0 1 1-1.9-4.15M13.6 1.6v3.1h-3.1\"/></svg>\n        </button>\n        <button data-m=\"daily\" class=\"on\">每天</button>\n        <button data-m=\"weekly\">每周</button>\n        <button data-m=\"cumulative\">累计总量</button>\n      </div>\n    </div>\n  </header>\n\n  <div class=\"card\">\n    <div class=\"stats\" id=\"stats\"></div>\n  </div>\n\n  <div class=\"card gridcard\">\n    <div class=\"gridbox\" id=\"gridbox\">\n      <div class=\"months\" id=\"months\"></div>\n      <div class=\"gridrow\">\n        <div class=\"wd\"><span>一</span><span></span><span>三</span><span></span><span>五</span><span></span><span>日</span></div>\n        <div class=\"cols\" id=\"cols\"></div>\n      </div>\n    </div>\n  </div>\n\n  <div class=\"two\">\n    <div class=\"card\"><h2>按 API Key</h2><div id=\"bykey\"></div></div>\n    <div class=\"card\"><h2>按模型</h2><div id=\"bymodel\"></div></div>\n  </div>\n</div>\n</div>\n<div id=\"tip\"></div>"
		var PANEL_JS = function __ouPanel(ROOT, window, document) {
  /* 作用域助手：shadow root 没有 getElementById，用 querySelector 等价实现 */
  function __ouById(id) { try { return ROOT.querySelector('#' + id) } catch (e) { return null } }


  /* 数据来源：
     · 独立文件模式 —— 上方 <script type="application/json"> 里烤好的数据
     · 插件模式    —— 宿主给 window.__OFFICIAL_USAGE_DATA__（下一行就是消费点）
     ⚠️ 插件模式下这一步绝不能碰 DOM：后面的交互绑定依赖完整 DOM，
        早期版本在这里写了一句“暂无数据”把 .wrap 换掉，直接让脚本崩在
        getElementById('modes') === null 上。 */
  var __OU_PLUGIN__ = true;   // shadow 模式：数据由客户端注入
  var __OU_DATA__ = null;
  if(!__OU_PLUGIN__){
    try {
      var __ouRaw = __ouById('payload').textContent;
      if(__ouRaw && __ouRaw.trim().charAt(0)==='{') __OU_DATA__ = JSON.parse(__ouRaw);
    } catch(e){ /* 无内嵌数据 */ }
    if(!__OU_DATA__) __OU_DATA__ = window.__OFFICIAL_USAGE_DATA__ || null;
  }

  const DOM = { root: __ouById('official-usage-root') };

  // ------ 数据（插件模式下初始为 null，由宿主/自取后 bootstrap 注入） ------
  let DATA = __OU_DATA__;

  var LV_WEEKS = 53;

  function bootstrap(data){
    DATA = data;
    byDate.clear();
    if(DATA) for(const d of DATA.days) byDate.set(d.date, d);
    cum.clear(); acc = 0;
    if(DATA) for(const d of DATA.days){ acc += d.tokens; cum.set(d.date, acc); }
    weeks = buildWeeks();
    render(); renderTables();
  }

  function buildWeeks(){
    if(!DATA) return [];
    /* 网格一律按 **UTC** 算，别混用本地时间。
       ① 平台的分桶时间戳是 UTC 零点（实测：tz=28800 与 tz=0 返回的时间戳一样，都是 UTC 零点），
          宿主的 dayKey 也是 UTC——所以"哪一天"这件事从头到尾就是 UTC 语义；
       ② 早先这里写的是 new Date(iso+'T00:00:00')（本地零点）再 dt.toISOString()（UTC），
          在东八区等于把每一天都退回去一天：本地 10-04 00:00 = UTC 10-03 16:00 ⇒ 取到 '2026-10-03'。
          结果就是整张表错位一行 —— 「周日」那一行显示的是周六的日期（2026-10-04 用户报的）。 */
    const lastD = new Date(DATA.window.end+'T00:00:00Z');
    const dw = (lastD.getUTCDay()+6)%7;               // 0 = 周一
    const lastMon = new Date(lastD.getTime()-dw*DAY);
    const firstMon = new Date(lastMon.getTime()-(LV_WEEKS-1)*7*DAY);
    const out=[];
    for(let w=0; w<LV_WEEKS; w++){
      const days=[];
      for(let d=0; d<7; d++){
        const dt=new Date(firstMon.getTime()+(w*7+d)*DAY);
        const iso=dt.toISOString().slice(0,10);       // UTC 记法，与宿主 dayKey 同一套
        days.push({ date:iso, dt, future: dt.getTime()>lastD.getTime(), rec: byDate.get(iso) || null });
      }
      out.push(days);
    }
    return out;
  }
  const DAY = 86400000;
  const fmt = {  tok(n){ if(n>=1e9) return (n/1e9).toFixed(2)+'B'; if(n>=1e6) return (n/1e6).toFixed(1)+'M';
            if(n>=1e3) return (n/1e3).toFixed(1)+'K'; return String(n); },
    tokFull(n){ return n.toLocaleString('zh-CN'); },
    /* 档位边界用的短写法：5M / 20M / 200M / 1B（整值不拖 ".0"） */
    tokShort(n){ const u = n >= 1e9 ? [1e9,'B'] : n >= 1e6 ? [1e6,'M'] : n >= 1e3 ? [1e3,'K'] : [1,''];
                 const v = n / u[0]; return (Number.isInteger(v) ? v : v.toFixed(1)) + u[1]; },
    money(c){ return '¥'+c.toFixed(2); },
    date(s){ const [y,m,d]=s.split('-'); return `${y}年${+m}月${+d}日`; },
  };

  // ---------- 悬浮提示的三行文案（规格由用户 2026-10-04 定） ----------
  /** 日期：今年只写「10月3日」，跨年才写「2025年12月3日」 */
  function tipDate(iso){
    const [y,m,d] = iso.split('-');
    const thisYear = new Date().getUTCFullYear();      // 网格与日期都是 UTC 语义，年份也按 UTC 取
    return (+y === thisYear ? '' : y + '年') + (+m) + '月' + (+d) + '日';
  }
  /** token：≥1 亿写「亿」（2 位小数）、≥1 万写「万」（1 位小数）、再少写具体数字；数字与单位间留空格。
   *  万位本身到四位数（≥1000 万）时省掉小数，否则会出现「10000.0 万」这种读起来别扭的数。 */
  function tipTokens(n){
    if(!n) return '0 token';
    if(n >= 1e8) return (n / 1e8).toFixed(2) + ' 亿 token';
    if(n >= 1e4) {
      const w = n / 1e4;
      return (w >= 1000 ? Math.round(w).toLocaleString('zh-CN') : w.toFixed(1)) + ' 万 token';
    }
    return n.toLocaleString('zh-CN') + ' token';
  }
  function tipText(day, mode, week){
    const lines = [tipDate(day.date), tipTokens(day.rec ? day.rec.tokens : 0)];
    if(day.rec && day.rec.tokens) lines.push('花费 ' + day.rec.cost.toFixed(2) + ' 元');
    if(mode === 'weekly') lines.push('<b>本周 ' + tipTokens(weekTokenSum(week)) + '</b>');
    if(mode === 'cumulative') lines.push('<b>累计 ' + tipTokens(cum.get(day.date) || 0) + '</b>');
    return lines.join('<br>');
  }

  /* 档位边界（绝对阈值，跨月可比 —— 这是本插件的设计主张）：
       0        → 灰（当天没有用量）
       <5M / 5–20M / 20–60M / 60–120M / 120–200M / ≥200M   ← 六档绿
     边界由用户按自己的用量结构定的（2026-10-04）：他的日用量跨度约 1M–350M，
     最近 30 天落格 4/2/2/2/2/1，每档都有量。
     ⚠️ N 个边界 ⇒ N+1 个有色档：档位 = 1 + 满足的边界数。以前写成 i+1 会让顶档永远空着、
     最高的几天反而落到次高档（甚至更早那版直接返回一个不存在的 l5 → 回落成"没数据"色）。 */
  const LV = [5e6, 20e6, 60e6, 120e6, 200e6];
  const LV_TOP = LV.length + 1;                        // = 6，顶档
  function level(v, mode){
    if(!v) return 0;
    if(mode==='cumulative'){
      // 累计是总量的量级，拿每日阈值去卡会整片顶格：按累计最大值的等分带分成六档
      const max = acc || 1, r = v / max;
      for(let i=LV.length-1;i>=0;i--) if(r >= (i+1)/(LV.length+1)) return i+2;
      return 1;
    }
    let sat = 0;
    for(let i=0;i<LV.length;i++) if(v >= LV[i]) sat++;
    return sat + 1;                                    // 1..LV_TOP
  }

  // build the 53-week grid (Monday first), ending this week
  const byDate = DATA ? new Map(DATA.days.map(d=>[d.date,d])) : new Map();
  let weeks = [];
  if(DATA) weeks = buildWeeks();

  // ---------- aggregation ----------
  function weekTokenSum(w){ return w.reduce((a,d)=>a+(d.rec?.tokens||0),0); }
  function valueFor(mode, { day, week }){
    if(mode==='daily')   return day.rec?.tokens || 0;
    if(mode==='weekly')  return weekTokenSum(week);
    return cum.get(day.date) || 0;              // cumulative: running total up to that day
  }

  // running cumulative (daily granularity) over the whole window
  const cum = new Map(); let acc=0;
  if(DATA) for(const d of DATA.days){ acc += d.tokens; cum.set(d.date, acc); }
  window.__cum = cum;

  const state = { mode:'daily' };

  function render(){
    if(!DATA) return;
    const mode = state.mode;
    const scaleMax = mode==='cumulative' ? acc : null;

    // 月份轴：绝对定位到对应列上（左侧留出星期列 27px）
    const months = __ouById('months');
    const CSTEP = 17;                       // 13px 格子 + 4px 间隙
    months.innerHTML='';
    let prevM=null, lastLabelWeek=-99;
    weeks.forEach((w,i)=>{
      const m = w[0].dt.getUTCMonth();                 // 与上面同一套 UTC 语义
      // 离上一个标签不足 3 列就不标，免得挤在一起
      if(m!==prevM && i<52 && (i-lastLabelWeek)>=3){
        const s=document.createElement('span');
        s.textContent = (prevM===null ? w[0].dt.getUTCFullYear()+'年' : '') + (m+1)+'月';
        s.style.left = (i*CSTEP) + 'px';
        months.appendChild(s);
        lastLabelWeek=i;
      }
      prevM=m;
    });

    // cells
    const cols=__ouById('cols');
    cols.innerHTML='';
    for(const w of weeks){
      const col=document.createElement('div'); col.className='col';
      for(const d of w){
        const c=document.createElement('div'); c.className='c';
        const v=valueFor(mode,{day:d,week:w});
        if(!d.future){ c.classList.add('l'+level(v, mode)); }
        else { c.style.background='transparent'; c.style.boxShadow='inset 0 0 0 1px var(--line)'; }
        /* 悬浮提示：日视图严格三行 —— 日期 / token / 花费。
           没有用量的过去日子也给提示，就两行（日期 + 0 token）；未来的格子仍然不给提示。
           日期：今年只写「月日」，跨年才带上年份。
           token：≥1 亿写「亿」（2 位小数）、≥1 万写「万」（1 位小数）、再少就写具体数字，
                 数字与单位之间留一个空格。
           周 / 累计视图下格子代表的不是单日，额外补一行说明（否则颜色含义对不上）。 */
        if(!d.future){
          c.dataset.tip='1';
          c.dataset.text = tipText(d, mode, w);
        }
        col.appendChild(c);
      }
      cols.appendChild(col);
    }

    // stats row（数字滚动动效）
    const T=DATA.totals, S=DATA.summary, B=DATA.balance;
    // 余额 = 充值 + 赠金合并成一个数（不做单独标注）；
    // 兼容两种形状：host 返回 balance{normal,bonus} / 独立文件里的 summary.normal_wallets
    const wallet = (kind) => (
      (kind==='normal' ? (B?.normal ?? S?.normal_wallets) : (B?.bonus ?? S?.bonus_wallets))?.[0]?.balance
    );
    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    const bal = num(wallet('normal')) + num(wallet('bonus'));
    __ouById('stats').innerHTML = `
      <div class="stat"><div class="k">Token</div><div class="v" id="s-tok">—</div></div>
      <div class="stat"><div class="k">花费</div><div class="v" id="s-cost">—</div></div>
      <div class="stat"><div class="k">活跃天数</div><div class="v" id="s-days">—</div></div>
      <div class="stat"><div class="k">单日峰值</div><div class="v" id="s-peak">—</div></div>
      <div class="stat"><div class="k">请求次数</div><div class="v" id="s-req">—</div></div>
      <div class="stat"><div class="k">账户余额</div><div class="v" id="s-bal">—</div></div>`;
    countUp('s-tok',  T.tokens,                    v=>fmt.tok(Math.round(v)));
    countUp('s-cost', T.cost,                      v=>fmt.money(v), 2);
    countUp('s-days', T.activeDays,                v=>String(Math.round(v))+'<small>天</small>');
    countUp('s-peak', T.peakDay?.tokens||0,        v=>fmt.tok(Math.round(v))+(T.peakDay?`<small>${T.peakDay.date.slice(5)}</small>`:''));
    countUp('s-req',  T.requests,                  v=>Math.round(v).toLocaleString('zh-CN'));
    countUp('s-bal',  bal,                         v=>'¥'+v.toFixed(2), 2);

    // 重播草地生长动画（切换模式时）
    const colsEl = __ouById('cols');
    if(!REDUCED){
      colsEl.classList.remove('animate');
      void colsEl.offsetWidth;          // 强制重排，让 animation 重新开始
      colsEl.classList.add('animate');
    }

    // 图例按用户要求撤掉了（"神秘一点"），所以这里不再写 lgL / lgR。
    // 旧客户端手里那份 HTML 还带图例、旧脚本也还在写这两个 id —— 那是它自己的一份，互不影响。

    scrollToLatest();
  }

  /* 默认落在**最新（最右）**那一端：热力图是左旧右新，实际最常看的是右边。
     只在第一次画完时归位一次 —— 之后切换档位 / 点刷新都保留用户自己滚到的位置，
     免得「我在看六月，手一抖刷新就被甩回最右」。 */
  let scrollPinned = false;
  function scrollToLatest(){
    const g = __ouById('gridbox');
    if(!g || scrollPinned) return;
    scrollPinned = true;
    g.scrollLeft = g.scrollWidth;                 // 右端 = 最近几周
    // 首帧宽度可能还没算稳（字体/动画），下一帧再校一次
    requestAnimationFrame(function(){ g.scrollLeft = g.scrollWidth; });
  }

  // 数字滚动：从上一个显示值滚到新值
  const _statVals = new Map();
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function countUp(id, target, render, decimals){
    const el = __ouById(id); if(!el) return;
    const from = _statVals.get(id) ?? 0;
    _statVals.set(id, target);
    if(REDUCED){ el.innerHTML = render(target); return; }
    const dur = 620, t0 = performance.now();
    (function step(now){
      const p = Math.min(1,(now-t0)/dur);
      const e = 1-Math.pow(1-p,3);                    // easeOutCubic
      const v = from + (target-from)*e;
      el.innerHTML = render(decimals ? v : Math.round(v));
      if(p<1) requestAnimationFrame(step);
    })(t0);
  }

  // breakdown tables
  function table(rows, label){
    const max = Math.max(...rows.map(r=>r.total||r.tokens));
    return `<table><thead><tr><th>${label}</th><th class="num">Token</th><th class="num">占比</th><th class="num">活跃天</th><th></th></tr></thead><tbody>`+
      rows.map((r,i)=>{
        const t=r.total||r.tokens, pct=t/DATA.totals.tokens*100;
        return `<tr><td>${r.name||r.model}</td><td class="num">${fmt.tok(t)}</td><td class="num">${pct.toFixed(1)}%</td>`+
               `<td class="num">${r.activeDays??'—'}</td>`+
               `<td style="width:36%"><span class="bar" style="width:${Math.max(2,t/max*100)}%;animation-delay:${0.12+i*0.06}s"></span></td></tr>`;
      }).join('')+`</tbody></table>`;
  }
  function renderTables(){
    if(!DATA) return;
    __ouById('bykey').innerHTML = table(DATA.apiKeys,'API Key');
    __ouById('bymodel').innerHTML = table(DATA.models,'模型');
  }

  // interactions
  __ouById('modes').addEventListener('click', e=>{
    const b=e.target.closest('button'); if(!b) return;
    // 刷新键现在也住在这个胶囊里，点它不能当成切换视图
    if(!b.dataset.m) return;
    [...e.currentTarget.children].forEach(x=>x.classList.toggle('on', x===b));
    state.mode=b.dataset.m; render();
  });
  const tip=__ouById('tip');

  /* 悬停提示的定位：面板内嵌进宿主文档后，祖先里只要有 backdrop-filter / transform / filter
     （DSH 设置窗口 + 壁纸插件的玻璃面就是），position:fixed 的**包含块**就从视口变成那个祖先，
     于是 tip 会按祖先的内容坐标摆放、并随其滚动越偏越远，最后被 overflow 裁掉——表现就是
     「鼠标悬停格子什么也不显示」。把 tip 挂进 top layer（popover）就与祖先无关了：
     top layer 里的 fixed 永远以视口为准，也不吃祖先的裁剪。
     不支持 popover 的环境（老内核）退回原来的 fixed 行为，至少独立打开时是对的。 */
  var tipTopLayer = false;
  try {
    if(tip && typeof tip.showPopover === 'function'){
      tip.setAttribute('popover','manual');
      tipTopLayer = true;
    }
  }catch(e){ tipTopLayer = false; }

  function showTip(){
    tip.classList.add('on');
    if(!tipTopLayer) return;
    try { if(!tip.matches(':popover-open')) tip.showPopover(); } catch(e){ /* 已开或不可用：忽略 */ }
  }
  function hideTip(){
    tip.classList.remove('on');
    if(!tipTopLayer) return;
    try { if(tip.matches(':popover-open')) tip.hidePopover(); } catch(e){ /* ignore */ }
  }

  ROOT.addEventListener('mouseover', e=>{
    const c=e.target.closest('.c[data-tip]'); if(!c) return;
    tip.innerHTML=c.dataset.text; showTip();
  });
  ROOT.addEventListener('mousemove', e=>{
    if(!tip.classList.contains('on')) return;
    const pad=14; let x=e.clientX+pad, y=e.clientY+pad;
    const r=tip.getBoundingClientRect();
    if(x+r.width>innerWidth-8) x=e.clientX-r.width-pad;
    if(y+r.height>innerHeight-8) y=e.clientY-r.height-pad;
    tip.style.left=x+'px'; tip.style.top=y+'px';
  });
  ROOT.addEventListener('mouseout', e=>{
    if(e.target.closest('.c[data-tip]')) hideTip();
  });

  // 刷新：先让宿主强刷（跳过它那份 10 分钟缓存），再取回新数据重画
  // 独立文件模式下没有宿主路由，按钮仍然在，取不到就提示一下。
  var REFRESH_URL = (typeof __OU_REFRESH_URL__ !== 'undefined') ? __OU_REFRESH_URL__ : '/dsh-official-usage/api/refresh';
  var STATE_URL = (typeof __OU_STATE_URL__ !== 'undefined') ? __OU_STATE_URL__ : '/dsh-official-usage/api/state';
  function refreshNow(){
    var btn = __ouById('refresh');
    if(!btn || btn.disabled) return;
    // 只有图标，所以状态挂在 title / aria-label 上，失败时按钮变红抖一下
    btn.disabled = true; btn.classList.remove('err'); btn.classList.add('busy');
    btn.title = '刷新中…'; btn.setAttribute('aria-label', '刷新中…');
    fetch(REFRESH_URL, { cache: 'no-store' })
      .then(function(){ return fetch(STATE_URL + '?fresh=1', { cache: 'no-store' }); })
      .then(function(r){ return r.json(); })
      .then(function(d){
        if(!d || d.error || !d.days) throw new Error((d && d.error) || '数据为空');
        bootstrap(d);                     // 重画 + 重播草地生长动画
        btn.title = '刷新'; btn.setAttribute('aria-label', '刷新');
      })
      .catch(function(e){
        btn.classList.add('err');
        btn.title = '刷新失败：' + e.message;
        btn.setAttribute('aria-label', '刷新失败');
      })
      .finally(function(){
        setTimeout(function(){
          btn.disabled = false; btn.classList.remove('busy');
        }, 400);
      });
  }
  var _rb = __ouById('refresh');
  if(_rb) _rb.addEventListener('click', refreshNow);

  // 宿主用：宿主把数据交给面板（插件模式）
  window.__officialUsageMount = function(payload){ if(payload) bootstrap(payload); };
  window.__officialUsageSetData = function(payload){ bootstrap(payload); };
  window.__officialUsageRefresh = refreshNow;

  if(!__OU_PLUGIN__){
    render(); renderTables();       // 独立文件模式：数据已内嵌
  }


  return window;   // 面板的 window.__officialUsage* 出口就在这个空壳上
}
		var PANEL_CSS_REV = "7ebfd67f6c36"
		var PANEL_JS_REV = "7d4ac795c3ba"

		/**
		 * 设置页导航图标：3×3 热力图格子。
		 *
		 * **为什么需要打补丁**（2026-09-25 查证，来自 dsh-usage-heatmap 的实测记录）：
		 *   ① 宿主 `ui-settings-general` 的 `navIcon(id)` 是按 id 硬编码的图标映射，
		 *      未知 id 一律回落成齿轮；
		 *   ② `settings.section` 槽位契约只有 id / order / label，**没有 icon 字段**；
		 *   ③ 借官方已发布的 id 会顶替掉官方分区，不可行。
		 * ⇒ 做法：给「我们这一行」打标记，CSS 藏掉外壳的齿轮、用 mask 画出本图标。
		 *   图标纯黑走 mask（只读 alpha），可见色由 background-color: currentColor 提供，
		 *   所以 hover / 选中 / 禁用都会自动跟随主题色。
		 *   宿主 DOM 变了补丁会**静默失效**，不影响面板本体。
		 */
		var NAV_ICON_MASK = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cg fill='%23000'%3E%3Crect x='2' y='2' width='3' height='3' rx='0.8' opacity='.25'/%3E%3Crect x='6' y='2' width='3' height='3' rx='0.8' opacity='.45'/%3E%3Crect x='10' y='2' width='3' height='3' rx='0.8' opacity='.65'/%3E%3Crect x='2' y='6' width='3' height='3' rx='0.8' opacity='.45'/%3E%3Crect x='6' y='6' width='3' height='3' rx='0.8' opacity='.65'/%3E%3Crect x='10' y='6' width='3' height='3' rx='0.8' opacity='.85'/%3E%3Crect x='2' y='10' width='3' height='3' rx='0.8' opacity='.65'/%3E%3Crect x='6' y='10' width='3' height='3' rx='0.8' opacity='.85'/%3E%3Crect x='10' y='10' width='3' height='3' rx='0.8'/%3E%3C/g%3E%3C/svg%3E\")"
		var NAV_ICON_MARKER = 'data-dou-nav-icon'
		var NAV_ROW_SELECTOR = '[role="dialog"] nav button'

		function navIconCss() {
			return [
				'[' + NAV_ICON_MARKER + '] > svg { display: none; }',
				'[' + NAV_ICON_MARKER + ']::before {',
				"  content: '';",
				'  flex: none;',
				'  width: 16px;',
				'  height: 16px;',
				'  background-color: currentColor;',
				'  -webkit-mask-image: ' + NAV_ICON_MASK + ';',
				'  mask-image: ' + NAV_ICON_MASK + ';',
				'  -webkit-mask-repeat: no-repeat;',
				'  mask-repeat: no-repeat;',
				'  -webkit-mask-position: center;',
				'  mask-position: center;',
				'  -webkit-mask-size: 16px 16px;',
				'  mask-size: 16px 16px;',
				'}',
			].join('\n')
		}

		function installSettingsNavIcon() {
			if (typeof document === 'undefined' || !document.body) return function () {}

			var tag = document.createElement('style')
			tag.id = 'dou-nav-icon-style'
			tag.textContent = navIconCss()
			document.head.appendChild(tag)

			var disposed = false
			var scheduled = false

			function sync() {
				scheduled = false
				if (disposed) return
				var wanted = String(SECTION_LABEL || '').trim()
				if (!wanted) return   // label 还没就绪：什么都不标记，绝不因空串认领整列
				var rows = document.querySelectorAll(NAV_ROW_SELECTOR)
				for (var i = 0; i < rows.length; i++) {
					var row = rows[i]
					if (String(row.textContent || '').trim() === wanted) row.setAttribute(NAV_ICON_MARKER, '')
					else row.removeAttribute(NAV_ICON_MARKER)   // 幂等：别行的陈旧标记一起清掉
				}
			}

			function schedule() {
				if (scheduled || disposed) return
				scheduled = true
				var qm = typeof queueMicrotask === 'function' ? queueMicrotask : function (f) { setTimeout(f, 0) }
				qm(sync)
			}

			sync()
			var observer = null
			try {
				observer = new MutationObserver(schedule)
				// subtree + characterData：设置页是挂到 body 的门户，切换语言会改写 label 文本
				observer.observe(document.body, { childList: true, subtree: true, characterData: true })
			} catch (e) { /* 观察失败：至少已同步过一次 */ }

			return function () {
				disposed = true
				try { if (observer) observer.disconnect() } catch (e) { /* ignore */ }
				var marked = document.querySelectorAll('[' + NAV_ICON_MARKER + ']')
				for (var i = 0; i < marked.length; i++) {
					try { marked[i].removeAttribute(NAV_ICON_MARKER) } catch (e) { /* ignore */ }
				}
				try { tag.remove() } catch (e) { /* ignore */ }
			}
		}

		// ------------------------------------------------------------------
		// 宿主状态：两个标记，直接读 DSH / 壁纸插件自己维护的属性
		//   body[data-ds-dark-theme]   深色主题（ui-layout 的 theme-presenter 维护，宿主 CSS 也用它选调色板）
		//   body[data-we-wallpaper]    壁纸插件已在跑（它把 --dsw-alias-bg-base 改成了 transparent）
		// ------------------------------------------------------------------
		var themeCtx = null
		var ctxRef = { current: null }

		function themeFromSnapshot(snap) {
			try {
				if (!snap || typeof snap !== 'object') return null
				var active = snap.active
				if (active && typeof active.colorScheme === 'string') return active.colorScheme
				if (active && (active.id === 'dark' || active.id === 'light')) return active.id
				if (snap.preference === 'dark' || snap.preference === 'light') return snap.preference
			} catch (e) { /* ignore */ }
			return null
		}

		/** 读宿主当前的深浅色。DOM 标记优先——它才是真正决定配色的那个。 */
		function hostIsDark() {
			try {
				var body = document.body
				if (body && typeof body.hasAttribute === 'function') {
					if (body.hasAttribute('data-ds-dark-theme')) return true
					// body 上没有任何标记、或明确没有暗色标记：以 theme 服务为准（极早期 DOM 还没标记）
					if (themeCtx && typeof themeCtx.getTheme === 'function') {
						var t = themeFromSnapshot(themeCtx.getTheme())
						if (t === 'dark') return true
						if (t === 'light') return false
					}
					if (document.documentElement && document.documentElement.getAttribute) {
						// 有些壳会把来源写在根元素上：light / dark / system
						var src = document.documentElement.getAttribute('data-ds-theme-source')
						if (src === 'dark') return true
						if (src === 'light') return false
					}
					return false
				}
			} catch (e) { /* ignore */ }
			try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) } catch (e) { return false }
		}

		function bodyHas(attr) {
			try { return !!(document.body && document.body.hasAttribute && document.body.hasAttribute(attr)) } catch (e) { return false }
		}

		/** 把宿主的两个标记镜像到 shadow 宿主元素上——shadow 内部没法选中祖先，只能由外面写进来。 */
		function syncHostMarks(host) {
			if (!host || !host.setAttribute) return
			var dark = hostIsDark()
			if (host.getAttribute('data-theme') !== (dark ? 'dark' : 'light')) host.setAttribute('data-theme', dark ? 'dark' : 'light')
			if (bodyHas('data-we-wallpaper')) {
				if (!host.hasAttribute('data-we')) host.setAttribute('data-we', '')
			} else if (host.hasAttribute && host.hasAttribute('data-we')) {
				host.removeAttribute('data-we')
			}
		}

		// ------------------------------------------------------------------
		// 面板：一个宿主 div + shadow root + 铺在里面的面板根节点
		// ------------------------------------------------------------------
		/**
		 * 用给定资产在 shadow root 里铺好面板，并跑一遍面板脚本。
		 * 面板脚本拿到的「根」是 holder（不是 shadow root）：重铺时换一个 holder，
		 * 挂在它身上的事件委托随之作废，不会攒出重复监听。
		 */
		function paintPanel(host, assets) {
			var root = host.shadowRoot
			if (!root) {
				try { root = host.attachShadow({ mode: 'open' }) } catch (e) { return null }
			}
			if (!root) return null

			while (root.firstChild) root.removeChild(root.firstChild)

			var style = document.createElement('style')
			style.setAttribute('data-ou', 'style')
			style.textContent = assets.css
			root.appendChild(style)

			var holder = document.createElement('div')
			holder.setAttribute('data-ou', 'panel')
			holder.innerHTML = assets.html
			root.appendChild(holder)

			var err = document.createElement('div')
			err.setAttribute('data-ou', 'error')
			err.setAttribute('hidden', '')
			err.style.cssText = 'padding:48px 4px;text-align:center;color:var(--dim);font-size:13px'
			root.appendChild(err)

			// 面板脚本在面板根里跑：window 传一个空壳，它的 window.__officialUsage* 出口就落在这里
			var api = PANEL_JS(holder, {}, document)
			return { root: root, holder: holder, api: api }
		}

		function showError(root, message) {
			var err = root.querySelector('[data-ou="error"]')
			if (!err) return
			err.textContent = '取数据失败：' + message
			err.removeAttribute('hidden')
		}

		function hideError(root) {
			var err = root.querySelector('[data-ou="error"]')
			if (err) err.setAttribute('hidden', '')
		}

		function loadData(painted, force) {
			if (!painted) return Promise.resolve()
			return fetch(STATE_URL + (force ? '?fresh=1' : ''), { cache: 'no-store' })
				.then(function (r) { return r.json() })
				.then(function (d) {
					if (!d || d.error || !d.days || !d.days.length) throw new Error((d && d.error) || '宿主还没取到平台用量数据')
					painted.generatedAt = d.generatedAt || null
					hideError(painted.root)
					var api = painted.api
					if (api && typeof api.__officialUsageSetData === 'function') api.__officialUsageSetData(d)
				})
				.catch(function (e) { showError(painted.root, String((e && e.message) || e)) })
		}

		/**
		 * 面板开着的时候自己保持新鲜。
		 *
		 * 以前只在挂载时取一次数：设置页开着不动，格子就一直是「打开那一刻」的快照 ——
		 * 新的一天不会出现新格子，今天那格也不会变绿（2026-10-04 用户报的）。
		 * 现在的规矩：
		 *   · 数据还没过期（< 10 分钟，与宿主的缓存 TTL 对齐）→ 只重取缓存，几毫秒
		 *   · 数据过期了 → 先让宿主重采（/api/refresh，宿主那边有并发与 7 天窗口分片，
		 *     不会因为多开几个面板就把平台接口打爆），再取回来重画
		 * 于是「今天这一格的绿色」最多 10 分钟就会跟上，「新的一天」最多 10 分钟就会出现。
		 */
		var DATA_POLL_MS = 5 * 60 * 1000
		var DATA_STALE_MS = 10 * 60 * 1000

		function pollData(host) {
			var painted = host && host.__ouPainted
			if (!painted) return
			var at = painted.generatedAt ? Date.parse(painted.generatedAt) : 0
			if (at && (Date.now() - at) < DATA_STALE_MS) { loadData(painted, false); return }
			fetch(REFRESH_URL, { cache: 'no-store' })
				.catch(function () { /* 重采失败也要把手上这份显示出来 */ })
				.then(function () { return loadData(host.__ouPainted, false) })
		}

		/**
		 * 拉一次运行时资产（宿主路由，no-store）：
		 *   · 脚本版本一致 → CSS/HTML 整块重铺 ⇒ **改外观不用重启**
		 *   · 脚本也变了   → 只换 CSS（外观立即生效），结构/逻辑等下次重启
		 * 拉不到就继续用内嵌的那份，面板照常可用。
		 */
		function refreshPanelAssets(host) {
			return fetch(PANEL_ASSETS_URL, { cache: 'no-store' })
				.then(function (r) { return r.json() })
				.then(function (a) {
					if (!a || typeof a.css !== 'string' || typeof a.html !== 'string') return
					var live = host.__ouPainted
					if (!live) return
					if (a.cssRev === PANEL_CSS_REV && a.jsRev === PANEL_JS_REV) return
					if (a.jsRev === PANEL_JS_REV) {
						var again = paintPanel(host, { css: a.css, html: a.html })
						if (!again) return
						host.__ouPainted = again
						syncHostMarks(host)
						loadData(again, false)
					} else {
						var st = live.root.querySelector('style[data-ou="style"]')
						if (st) st.textContent = a.css
					}
				})
				.catch(function () { /* 用内嵌的那份 */ })
		}

		function mountPanel(host) {
			var painted = paintPanel(host, { css: PANEL_CSS, html: PANEL_HTML })
			if (!painted) return null
			host.__ouPainted = painted
			syncHostMarks(host)
			loadData(painted, false)
			refreshPanelAssets(host)
			return painted
		}

		function Panel() {
			var hostRef = React.useRef(null)

			React.useEffect(function () {
				var host = hostRef.current
				if (!host) return
				mountPanel(host)

				// 宿主换主题 / 开关壁纸：两个属性都在 body 上，一次 MutationObserver 全包
				var observer = null
				try {
					observer = new MutationObserver(function () { syncHostMarks(host) })
					observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'data-we-wallpaper'] })
				} catch (e) { /* 观察不到就靠下面的轮询 */ }

				var off = null
				try {
					if (ctxRef.current && typeof ctxRef.current.on === 'function') {
						off = ctxRef.current.on('theme/change', function () { syncHostMarks(host) })
					}
				} catch (e) { off = null }

				var timer = setInterval(function () { syncHostMarks(host) }, 2000)

				// 数据自己保持新鲜：每 5 分钟看一次（过期就让宿主重采），
				// 窗口重新可见时也看一次（从别的窗口切回来时最可能是"很久没更新"的那一下）
				var dataTimer = setInterval(function () { pollData(host) }, DATA_POLL_MS)
				var onVisible = function () { if (!document.hidden) pollData(host) }
				try { document.addEventListener('visibilitychange', onVisible) } catch (e) { /* ignore */ }

				return function () {
					clearInterval(timer)
					clearInterval(dataTimer)
					try { document.removeEventListener('visibilitychange', onVisible) } catch (e) { /* ignore */ }
					try { if (observer) observer.disconnect() } catch (e) { /* ignore */ }
					try { if (typeof off === 'function') off() } catch (e) { /* ignore */ }
				}
			}, [])

			return h('div', { ref: hostRef, className: 'dou-host' })
		}

		function registerAll(ctx) {
			var slots = ctx.slots
			var disposers = []
			disposers.push(slots.inject('settings.section', function () {
				return slots.register({
					name: 'settings.section',
					id: 'official-usage-settings',
					order: 23,
					label: function () { return SECTION_LABEL },
				}, Panel)
			}))
			// 图标补丁放在分区注册之后：必须先有分区才有导航行
			disposers.push(installSettingsNavIcon())
			return function () {
				for (var i = 0; i < disposers.length; i++) {
					try { disposers[i]() } catch (e) { /* ignore */ }
				}
			}
		}

		function start(ctx) {
			ctxRef.current = ctx
			try { themeCtx = ctx && ctx.theme ? ctx.theme : null } catch (e) { themeCtx = null }
			return registerAll(ctx)
		}

		// ⚠️ 必须是 export const（注入器骨架按文本校验）
		return {
			name: PLUGIN_ID,
			inject: ['slots', 'theme'],
			apply: function (ctx) {
				ctx.effect
					? ctx.effect(function () { return start(ctx) }, PLUGIN_ID + ': settings section')
					: start(ctx)
			},
		}
	},
})
