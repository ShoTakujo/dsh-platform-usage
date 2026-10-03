// 面板启动前的主题判定。由 build-plugin.mjs 原样嵌进 <script>（按文件读，不走模板字符串，
// 免得正则里的 \s \d 被 JS 转义吃掉——这个坑真踩过）。
//
// 优先级：
//   1. 宿主显式传的 ?theme=dark|light（客户端读 DSH 的 --dsw-alias-bg-base 后带上）
//   2. 自己顺着 frame 链往上读宿主文档（同源才行；这样客户端没更新时不重启也能对）
//   3. 系统偏好 prefers-color-scheme（独立打开面板时）
(function () {
  function lum(color) {
    var m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(color || '');
    if (!m) return null;
    return (0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])) / 255;
  }

  function fromAncestors() {
    var w = window;
    for (var i = 0; i < 8; i++) {
      if (w === w.parent) break;
      w = w.parent;
      try {
        var cs = w.getComputedStyle(w.document.documentElement);
        var l = lum(cs.getPropertyValue('--dsw-alias-bg-base'));
        if (l === null) l = lum(cs.backgroundColor);
        if (l !== null) return l < 0.5 ? 'dark' : 'light';
      } catch (e) { /* 跨源：继续往上找 */ }
    }
    return null;
  }

  var param = new URLSearchParams(location.search).get('theme');
  var source = 'param';
  var theme = (param === 'dark' || param === 'light') ? param : null;

  if (!theme) { theme = fromAncestors(); source = 'ancestor'; }
  if (!theme) {
    source = 'system';
    theme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }

  document.documentElement.setAttribute('data-theme', theme);
  window.__OU_THEME__ = { theme: theme, source: source };
})();
