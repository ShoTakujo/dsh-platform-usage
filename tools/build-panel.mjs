// Generate the DSH plugin panel from the standalone dashboard template.
//
//   src/panel/template.html  ->  plugin/lib/dashboard.html   (面板本体，iframe 加载)
//                                plugin/lib/dashboard.js     (同一份脚本，便于阅读)
//                                plugin/lib/styles.css       (提取出来的样式)
//
// 用法：node tools/build-panel.mjs
// 位置无关：所有路径都相对本文件解析，clone 到任何地方都能跑。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src', 'panel', 'template.html');
const PLUGIN = join(ROOT, 'plugin');
mkdirSync(join(PLUGIN, 'lib'), { recursive: true });

const html = readFileSync(SRC, 'utf8');

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

const doc = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>${css}</style>
<style>
  /* 插件内嵌：去掉独立页面的最大宽度，交给宿主容器 */
  html,body{background:transparent}
  .wrap{max-width:none;padding:2px 2px 10px}
  .loading{padding:60px 0;text-align:center;color:var(--dim);font-size:13px}
</style>
</head>
<body>
${rootHtml}
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

writeFileSync(join(PLUGIN, 'lib', 'dashboard.html'), doc, 'utf8');
writeFileSync(join(PLUGIN, 'lib', 'dashboard.js'), adapted, 'utf8');
writeFileSync(join(PLUGIN, 'lib', 'styles.css'), css, 'utf8');

console.log('dashboard.html', (doc.length / 1024).toFixed(1), 'KB');
console.log('dashboard.js  ', (adapted.length / 1024).toFixed(1), 'KB');
console.log('styles.css    ', (css.length / 1024).toFixed(1), 'KB');
console.log('->', join(PLUGIN, 'lib'));
