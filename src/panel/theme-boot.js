// 面板启动前的主题判定 —— 由 build-plugin.mjs 原样嵌进 <script>
// （按文件读入，不走模板字符串：正则里的 \s \d 会被 JS 转义吃掉，这个坑踩过）
//
// 优先级：
//   1. 宿主显式传的 ?theme=dark|light（客户端读 DSH 的 --dsw-alias-bg-base 后带上）
//   2. 自己顺着 frame 链往上读宿主文档（同源才行）
//   3. 系统偏好 prefers-color-scheme
//
// 同时把判定过程记进 window.__OU_DIAG__，出问题时能在控制台/诊断条里看到每一步。
(function () {
  var diag = { steps: [], chain: [], decided: null, source: 'system', param: null };

  // 支持 #rgb / #rrggbb 与 rgb()/rgba()。
  // 注意：getComputedStyle 对**自定义属性**返回的是原始写法（宿主常写 hex），
  // 只认 rgb() 会解析失败并悄悄退回系统偏好——这就是「面板白色」那次的根因。
  function lum(color) {
    var s = String(color || '').trim();
    var hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
    if (hex) {
      var v = hex[1];
      if (v.length === 3) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
      var r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16);
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }
    var m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s);
    if (!m) return null;
    return (0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])) / 255;
  }

  function readVar(win, name) {
    try { return String(win.getComputedStyle(win.document.documentElement).getPropertyValue(name) || '').trim(); }
    catch (e) { return null; }
  }

  // 1) 宿主参数
  try { diag.param = new URLSearchParams(location.search).get('theme'); } catch (e) { diag.param = null; }
  if (diag.param === 'dark' || diag.param === 'light') {
    diag.decided = diag.param;
    diag.source = 'param';
    diag.steps.push('用了宿主传的 ?theme=' + diag.param);
  }

  // 2) 顺着 frame 链往上读
  if (!diag.decided) {
    var w = window;
    for (var i = 0; i < 8; i++) {
      var isTop = false;
      try { isTop = (w === w.parent); } catch (e) { isTop = false; }
      if (isTop) { diag.steps.push('第 ' + i + ' 层：已经是顶层文档'); break; }
      try { w = w.parent; } catch (e) { diag.steps.push('第 ' + i + ' 层：跨源，停'); break; }

      var alive = false;
      try { alive = !!w.document && !!w.document.documentElement; } catch (e) { alive = false; }
      var bgBase = alive ? readVar(w, '--dsw-alias-bg-base') : null;
      diag.chain.push({ level: i + 1, reachable: alive, bgBase: bgBase });

      if (!alive) { diag.steps.push('第 ' + (i + 1) + ' 层：读不到文档（跨源）'); continue; }
      var l = lum(bgBase);
      if (l === null) { diag.steps.push('第 ' + (i + 1) + ' 层：--dsw-alias-bg-base="' + bgBase + '" 解析不出颜色'); continue; }
      diag.decided = l < 0.5 ? 'dark' : 'light';
      diag.source = 'ancestor@' + (i + 1);
      diag.steps.push('第 ' + (i + 1) + ' 层：' + bgBase + ' → 亮度 ' + l.toFixed(3) + ' → ' + diag.decided);
      break;
    }
  }

  // 3) 系统偏好
  if (!diag.decided) {
    var sysDark = false;
    try { sysDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); } catch (e) { /* ignore */ }
    diag.decided = sysDark ? 'dark' : 'light';
    diag.source = 'system';
    diag.steps.push('回落到系统偏好：' + (sysDark ? '暗色' : '亮色'));
  }

  document.documentElement.setAttribute('data-theme', diag.decided);
  window.__OU_THEME__ = diag;
  window.__OU_DIAG__ = diag;
})();
