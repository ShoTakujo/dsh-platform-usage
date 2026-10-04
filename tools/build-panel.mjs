// Generate the DSH plugin panel + the client bundle from the standalone dashboard template.
//
//   src/panel/template.html   ->  plugin/lib/dashboard.html   （独立页 / 宿主路由 /panel.html，调试用）
//   src/panel/template.html   ->  plugin/lib/dashboard.js     （同一份面板脚本，便于阅读）
//   src/panel/template.html   ->  plugin/lib/styles.css       （提取出来的样式）
//   src/panel/theme-boot.js   ->  嵌进 dashboard.html 的主题判定脚本（独立页用）
//
//   src/panel/template.html ─┐
//   src/client/client.src.js ┴→  plugin/client/client.js      （Shadow DOM 版客户端：
//                                CSS 改成 :host、面板脚本作用域到 shadow root、三份产物内嵌为字面量）
//
// 用法：node tools/build-panel.mjs
// 位置无关：所有路径都相对本文件解析，clone 到任何地方都能跑。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src', 'panel', 'template.html');
const BOOT = join(ROOT, 'src', 'panel', 'theme-boot.js');
const CLIENT_SRC = join(ROOT, 'src', 'client', 'client.src.js');
const PLUGIN = join(ROOT, 'plugin');
mkdirSync(join(PLUGIN, 'lib'), { recursive: true });
mkdirSync(join(PLUGIN, 'client'), { recursive: true });

const html = readFileSync(SRC, 'utf8');
// 主题脚本单独成文件再读进来：塞进模板字符串的话，正则里的 \s \d 会被 JS 当转义吃掉
// （踩过一次，产物里 /rgba?\(\s*(\d+)…/ 变成了 /rgba?(s*(d+)…/，探测直接空转）
const themeBoot = readFileSync(BOOT, 'utf8');
const clientSrc = readFileSync(CLIENT_SRC, 'utf8');

const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
if (!styleMatch) throw new Error('template.html 里找不到 <style>');
const css = styleMatch[1];

const scriptBlocks = [...html.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)];
if (!scriptBlocks.length) throw new Error('template.html 里找不到内联脚本');
const body = scriptBlocks.at(-1)[1];

// 插件模式下数据一律来自宿主，绝不使用内嵌 payload
const adapted = body
  .replace(/\bvar __OU_DATA__ = (?:\(function\(\)\{[\s\S]*?\}\)\(\)|window\.__OFFICIAL_USAGE_DATA__)/,
    'var __OU_DATA__ = null');
if (!adapted.includes('var __OU_DATA__ = null')) {
  throw new Error('payload 初始化没被改写 —— 检查 template.html 的数据引导段');
}

const rootMatch = html.match(/<div id="official-usage-root"[\s\S]*?<div id="tip"><\/div>/);
if (!rootMatch) throw new Error('template.html 里找不到面板根节点');
const rootHtml = rootMatch[0];

// ---------------------------------------------------------------------------
// ① 独立页 / 宿主路由页（plugin/lib/dashboard.html）
// ---------------------------------------------------------------------------
const doc = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>${css}</style>
<style>
  /* 插件内嵌：去掉独立页面的最大宽度，交给宿主容器。
     ⚠️ 背景**不能**写 transparent：iframe 自己的画布默认是白的，把 body 背景抹掉
     就等于「暗色主题 + 白底」——文字 #e8eaed、卡片是暗色玻璃，全糊在白色上
     （2026-10-04 定位到的真凶：这一行盖掉了上面的 body{background:var(--bg)}）。
     背景必须由面板自己按主题变量画，宿主是明是暗都不影响。 */
  html,body{background:var(--bg)}
  /* 画布与原生控件（滚动条）跟着主题走：此前暗色下面板里那条横向滚动条仍是白的 */
  :root{color-scheme:light}
  :root[data-theme="dark"]{color-scheme:dark}
  .wrap{max-width:none;padding:2px 2px 10px}
  .loading{padding:60px 0;text-align:center;color:var(--dim);font-size:13px}
</style>
</head>
<body>
${rootHtml}
<script>
${themeBoot}</script>
<script>var __OU_PLUGIN__ = true;</script>
<script>${adapted}</script>
<script>
(function(){
  // 打开面板先取一次数据（走宿主的 10 分钟缓存，毫秒级返回）；
  // 面板右上角的刷新键会带 fresh=1 强制重采。
  fetch('/dsh-official-usage/api/state', { cache: 'no-store' })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if(!d || !d.days || !d.days.length){ throw new Error((d && d.error) || '宿主还没取到平台用量数据'); }
      window.__OFFICIAL_USAGE_DATA__ = d;
      if(window.__officialUsageSetData) window.__officialUsageSetData(d);
      else if(window.__officialUsageMount) window.__officialUsageMount(d);
    })
    .catch(function(e){
      var w = document.querySelector('.wrap');
      if(w) w.innerHTML = '<p class="loading">取数据失败：' + e.message + '</p>';
    });
})();
</script>
</body></html>`;

if (doc.includes('__PAYLOAD_JSON__')) throw new Error('面板 HTML 里还留着 payload 占位符');
if (!doc.includes('/dsh-official-usage/api/state')) throw new Error('面板里没有数据拉取逻辑');
// 用「字面包含」而不是正则来断言——写断言时又被同一类转义坑绊过一次
for (const [name, needle] of [
  ['主题判定脚本', '__OU_THEME__'],
  ['亮度正则没被转义吃掉', String.raw`/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/`],
  ['面板根节点', 'id="official-usage-root"'],
]) {
  if (!doc.includes(needle)) throw new Error('面板产物缺少：' + name);
}

writeFileSync(join(PLUGIN, 'lib', 'dashboard.html'), doc, 'utf8');
writeFileSync(join(PLUGIN, 'lib', 'dashboard.js'), adapted, 'utf8');
writeFileSync(join(PLUGIN, 'lib', 'styles.css'), css, 'utf8');

// ---------------------------------------------------------------------------
// ② Shadow DOM 版客户端（plugin/client/client.js）
//
// 面板不再是 iframe，而是宿主文档里的一个 shadow root：
//   · CSS 依旧完全隔离，但自定义属性 / 可继承属性照常继承宿主
//     → --dsw-alias-*、--we-*（壁纸插件）、字体、color-scheme 全部自动生效；
//   · 卡片的 backdrop-filter 糊的是**真壁纸**（同一文档、同一 backdrop root）。
//
// 三处适配：
//   1) 选择器：:root → :host、body{} → :host{}（shadow 里没有文档根与 body），
//      底色改成问宿主要 --dsw-alias-bg-base（壁纸激活时它自己就是 transparent）。
//   2) 脚本：document.getElementById → 作用域查询；document.addEventListener → 挂在 shadow root
//      （跨 shadow 边界时 e.target 会被重定向成宿主元素，挂在外面接不到 .c）。
//   3) 出口：脚本以 (ROOT, window, document) 三个参数包成函数，window 传空壳，
//      它的 window.__officialUsage* 就落在壳上，客户端拿回来直接调。
// ---------------------------------------------------------------------------
const shadowCss = buildShadowCss(css);
const scopedJs = buildScopedPanelJs(adapted);
const cssRev = sha(shadowCss);
const jsRev = sha(scopedJs);
const rev = sha(cssRev + ':' + jsRev);

const clientOut = clientSrc
  .replace('/*__OU_PANEL_CSS__*/null', JSON.stringify(shadowCss))
  .replace('/*__OU_PANEL_HTML__*/null', JSON.stringify(rootHtml))
  .replace('/*__OU_PANEL_JS__*/null', scopedJs)
  .replace('/*__OU_PANEL_CSS_REV__*/null', JSON.stringify(cssRev))
  .replace('/*__OU_PANEL_JS_REV__*/null', JSON.stringify(jsRev));

for (const [name, needle] of [
  ['CSS 占位符', '/*__OU_PANEL_CSS__*/null'],
  ['HTML 占位符', '/*__OU_PANEL_HTML__*/null'],
  ['JS 占位符', '/*__OU_PANEL_JS__*/null'],
  ['CSS rev 占位符', '/*__OU_PANEL_CSS_REV__*/null'],
  ['JS rev 占位符', '/*__OU_PANEL_JS_REV__*/null'],
]) {
  if (clientOut.includes(needle)) throw new Error('客户端产物里还留着' + name + '（源文件被改过？）');
}
for (const [name, needle] of [
  ['shadow 选择器', ':host'],
  ['作用域 id 查询', '__ouById('],
  ['面板脚本出口', 'window.__officialUsageMount'],
  ['运行时资产地址', 'PANEL_ASSETS_URL'],
]) {
  if (!clientOut.includes(needle)) throw new Error('客户端产物缺少：' + name);
}
if (scopedJs.includes('document.getElementById(')) throw new Error('面板脚本还有没作用域化的 getElementById');

writeFileSync(join(PLUGIN, 'client', 'client.js'), clientOut, 'utf8');

// ---------------------------------------------------------------------------
// ③ 运行时资产：桌面端改外观不想重启，所以 CSS/HTML 另外出一份，
//    客户端挂载时用 no-store 拉一次，rev 对得上就直接换掉内嵌的那份。
//    JS 仍然只走内嵌（不在运行时 eval），所以「改结构/逻辑」还是要重启，改外观不用。
// ---------------------------------------------------------------------------
const assets = {
  rev,
  cssRev,
  jsRev,
  generatedAt: new Date().toISOString(),
  css: shadowCss,
  html: rootHtml,
};
writeFileSync(join(PLUGIN, 'lib', 'panel-assets.json'), JSON.stringify(assets) + '\n', 'utf8');

console.log('dashboard.html', (doc.length / 1024).toFixed(1), 'KB');
console.log('dashboard.js  ', (adapted.length / 1024).toFixed(1), 'KB');
console.log('styles.css    ', (css.length / 1024).toFixed(1), 'KB');
console.log('client.js     ', (clientOut.length / 1024).toFixed(1), 'KB  (shadow 版，含内嵌面板产物)');
console.log('panel-assets  ', 'cssRev=' + cssRev, 'jsRev=' + jsRev, 'rev=' + rev);
console.log('->', PLUGIN);

// ---------------------------------------------------------------------------
function buildShadowCss(raw) {
  let out = raw;
  // 先换带属性/伪类的 :root，避免被下面的全局替换打乱
  out = out.replace(/:root\[data-theme="dark"\]/g, ':host([data-theme="dark"])');
  out = out.replace(/:root:not\(\[data-theme="light"\]\)/g, ':host(:not([data-theme="light"]))');
  out = out.replace(/:root/g, ':host');
  // body 规则 → :host 规则：底色问宿主（--dsw-alias-bg-base 在壁纸激活时是 transparent），
  // 文字色同样优先跟宿主（壁纸插件会为了可读性改写 --dsw-alias-label-primary）。
  const bodyRule = /\n\s*body\{margin:0;background:var\(--bg\);color:var\(--text\);\s*\n\s*font:14px\/1\.5 ([^}]*)\}/;
  if (!bodyRule.test(out)) throw new Error('没找到 body 规则 —— template.html 的样式开头变了？');
  out = out.replace(bodyRule,
    '\n  /* shadow 里没有 html/body：宿主元素自己就是面板的画布。\n' +
    '     ⚠️ 底色**不刷**（transparent）：面板现在活在宿主文档里，不刷底色就会直接透出设置窗口自己的材质\n' +
    '     —— 和「插件市场」那种原生分区一模一样，壁纸玻璃、窗口底色都自动对上。\n' +
    '     早先 iframe 版本不能透明，是因为 iframe 自有画布、默认是白的（白底 bug 的根源）；\n' +
    '     换成 shadow DOM 之后那个前提已经不成立，反而刷一层 --dsw-alias-bg-base 会在玻璃窗口里\n' +
    '     露出一块颜色不同的实心方块（2026-10-05 用户报的）。\n' +
    '     文字色仍然优先跟宿主（壁纸插件为了可读性会改写 --dsw-alias-label-primary）。 */\n' +
    '  :host{display:block;background:transparent;\n' +
    '        color:var(--dsw-alias-label-primary,var(--text));\n' +
    '        font:14px/1.5 $1}');
  out += `
  /* 内嵌（shadow）模式：宽度交给宿主容器 */
  .wrap{max-width:none;padding:2px 2px 10px}
  /* 壁纸插件在跑时（客户端把 body[data-we-wallpaper] 镜像到宿主元素上）：
     卡片 / 胶囊 / 浮层改用宿主那套玻璃面 —— --dsw-alias-bg-layer-* 在壁纸激活时
     就是「主题底色压可读性下限 + 玻璃色按玻璃透明度混合」的配方，
     于是面板与设置窗口里其它玻璃同一配方，壁纸也从面板底下透出来。 */
  :host([data-we]) .card,
  :host([data-we]) .modes,
  :host([data-we]) #tip{background:var(--dsw-alias-bg-layer-1,var(--glass))}
  :host([data-we]){--text:var(--dsw-alias-label-primary,var(--text));--dim:var(--dsw-alias-label-secondary,var(--dim));--line:var(--dsw-alias-border-l1,var(--line))}
`;
  if (/:root/.test(out)) throw new Error('shadow CSS 里还有 :root');
  return out;
}

function buildScopedPanelJs(src) {
  let js = src;
  // 插件模式常开：数据由客户端注入，不走内嵌 payload 那条路
  const flag = "var __OU_PLUGIN__ = (typeof __OU_PLUGIN__ !== 'undefined');";
  if (!js.includes(flag)) throw new Error('没找到 __OU_PLUGIN__ 判定行');
  js = js.replace(flag, 'var __OU_PLUGIN__ = true;   // shadow 模式：数据由客户端注入');
  js = js.replace(/document\.getElementById\(/g, '__ouById(');
  js = js.replace(/document\.addEventListener\(/g, 'ROOT.addEventListener(');
  const indented = js.split('\n').map(l => (l ? '  ' + l : l)).join('\n');
  return `function __ouPanel(ROOT, window, document) {
  /* 作用域助手：shadow root 没有 getElementById，用 querySelector 等价实现 */
  function __ouById(id) { try { return ROOT.querySelector('#' + id) } catch (e) { return null } }

${indented}

  return window;   // 面板的 window.__officialUsage* 出口就在这个空壳上
}`;
}
