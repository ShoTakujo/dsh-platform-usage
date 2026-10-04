// Static + runtime smoke test for the client bundle, before it ever reaches DSH.
//   A) structural guards the host enforces (text checks, copied from the
//      dsh-usage-heatmap findings)
//   B) execute the factory with a fake require/ctx and assert that it registers
//      a React component into the 'settings.section' slot without throwing
//   C) mount the component against a fake DOM: shadow root assembled, panel
//      assets injected, data fetched, host markers mirrored, disposer cleans up
//
// 位置无关：产物路径相对本文件解析（clone 到哪都能跑）。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, '..', 'plugin', 'client', 'client.js');
const src = readFileSync(FILE, 'utf8');
const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');   // comments stripped for guard checks

let fails = 0;
const check = (ok, label, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };

console.log('--- A. host-side structural guards ---');
check(/window\.__ModuleLoader__\.load\(/.test(code), "registers via window.__ModuleLoader__.load");
check(/id:\s*'dsh-official-usage'/.test(code), 'module id present');
check(!/\bexport\s+const\b/.test(code), 'no stray TypeScript export syntax');
// 宿主校验的正则是 /export const inject\s*=\s*\[[^\]]*['"]slots['"]/（所以用对象字面量也行）
check(/inject:\s*\[[^\]]*'slots'[^\]]*\]/.test(code), "inject 里含 'slots'（宿主骨架校验要求）");
check(/inject:\s*\[[^\]]*'theme'[^\]]*\]/.test(code), "inject 里含 'theme'（主题服务，拿不到也不致命）");
check(/slots\.inject\('settings\.section'/.test(code), 'slot name is a string literal');
check(/slots\.register\(\{/.test(code), "'{' immediately follows register(");
check(/name:\s*'settings\.section'/.test(code), 'register options carry the slot name');
check(!/^\s*(import|export)\s/m.test(code), 'no ESM import/export at line start');
// 导航图标补丁（复制自 dsh-usage-heatmap 的实测方案）
check(/NAV_ICON_MASK/.test(code), '导航图标 mask 存在');
check(/mask-image:/.test(code), '用 mask-image 画图标');
check(/data-dou-nav-icon/.test(code), '导航行标记属性存在');
check(/\[role="dialog"\] nav button/.test(code), '导航行选择器存在');
check(/MutationObserver/.test(code), '监听 DOM 变化以补标记');
check(/installSettingsNavIcon\(\)/.test(code), '图标补丁在 apply 里被调用');

console.log('\n--- A2. 面板改成 shadow DOM（不再有 iframe）---');
check(!/createElement\(\s*'iframe'/.test(code), '不再创建 iframe 元素');
check(!/'iframe'/.test(code), "产物里没有 iframe 字样");
check(/attachShadow\(\{\s*mode:\s*'open'\s*\}\)/.test(code), '用 attachShadow 建影子根');
check(/host\.shadowRoot/.test(code), '重复挂载时复用已有 shadowRoot（React 双调用安全）');
check(/:host\{display:block;background:transparent/.test(code), '面板不刷底色（透出设置窗口自己的材质，和原生分区一致）');
check(/:host\(\[data-theme=\\?"dark\\?"\]\)/.test(code), 'shadow 版暗色选择器 :host([data-theme="dark"])');
check(/:host\(\[data-we\]\)/.test(code), '壁纸激活时卡片改用宿主玻璃面（:host([data-we])）');
check(/body\[data-ds-dark-theme\]|data-ds-dark-theme/.test(code), '深色判定用 DSH 自己的标记');
check(/data-we-wallpaper/.test(code), '壁纸标记 data-we-wallpaper 会镜像到宿主元素');
check(!/document\.getElementById\(/.test(src.split('function __ouPanel')[1] || ''), '面板脚本里已无 document.getElementById（全部作用域化）');
check(/__ouPanel\(ROOT, window, document\)/.test(code), '面板脚本包成 (ROOT, window, document) 函数');
check(/ROOT\.addEventListener\(/.test(code), '面板的 tooltip 监听挂在 shadow root 上（跨边界 e.target 会被重定向）');
check(!/\beval\(|new Function\(/.test(code), '不用 eval / new Function（CSP 友好）');

console.log('\n--- B. execute the factory ---');
let registered = null;
let effectFn = null;
const fakeReact = {
  createElement: (type, props, ...kids) => ({ $$typeof: 'react.element', type, props, kids }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: (fn) => { effectFn = fn },
  useCallback: (fn) => fn,
  useRef: (v) => ({ current: v }),
};
const fakeRequire = (id) => {
  if (id === 'react') return fakeReact;
  throw new Error('unexpected require: ' + id);
};

let loaderPayload = null;
globalThis.window = {
  __ModuleLoader__: { load: (p) => { loaderPayload = p } },
  addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: globalThis.__sysDark === true }),
};

// ---- 够用的假 DOM -----------------------------------------------------------
// 面板脚本在 shadow root 里跑，会按 id 抓一堆元素；用一个「万能元素」代理兜住，
// 这样客户端逻辑（挂载、注入、取数、镜像标记）才是真的被跑过。
function makeStubEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    _attrs: {}, children: [], style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false },
    textContent: '', innerHTML: '', id: '', className: '',
    setAttribute(k, v) { this._attrs[k] = v }, getAttribute(k) { return k in this._attrs ? this._attrs[k] : null },
    removeAttribute(k) { delete this._attrs[k] }, hasAttribute(k) { return k in this._attrs },
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { this.children.push(c); return c },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c },
    get firstChild() { return this.children.length ? this.children[0] : null },
    attachShadow(opts) { const r = makeStubEl('#shadow-root'); r.mode = opts && opts.mode; this.shadowRoot = r; return r },
    remove() {}, setProperty() {}, removeProperty() {},
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 }),
    querySelector: () => makeStubEl('div'),
    querySelectorAll: () => [],
  };
  return el;
}

const headChildren = [];
const navRow = makeStubEl('button');
navRow.textContent = '平台用量';
const byId = new Map();

let observerCallback = null;
let observerDisconnected = false;
let observedTarget = null;
globalThis.MutationObserver = class {
  constructor(cb) { observerCallback = cb }
  observe(target) { observedTarget = target }
  disconnect() { observerDisconnected = true }
};
globalThis.queueMicrotask = (fn) => fn();
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '', backgroundColor: 'rgba(0, 0, 0, 0)' });

let fetchCalls = [];
let pendingFetches = [];               // 每个 fetch 都先挂起，测试里手动放行，顺序可控
const FETCH_FIXTURE = { days: [{ date: '2026-10-01', tokens: 123 }], window: { end: '2026-10-01' }, totals: { tokens: 123 } };
// 运行时资产：默认「和内嵌一致」，测试可以改掉它来验重铺逻辑
let ASSETS_FIXTURE = null;
globalThis.fetch = (url, init) => {
  fetchCalls.push({ url: String(url), init });
  return new Promise((resolve) => {
    pendingFetches.push(() => resolve({
      json: () => Promise.resolve(String(url).includes('panel-assets') ? ASSETS_FIXTURE : FETCH_FIXTURE),
    }));
  });
};
const flushFetch = async () => { const q = pendingFetches; pendingFetches = []; q.forEach((f) => f()); await new Promise(r => setTimeout(r, 20)); };
const intervals = [];
globalThis.setInterval = (fn, ms) => { intervals.push(fn); return intervals.length };
globalThis.clearInterval = (id) => { intervals[id - 1] = null };

globalThis.document = {
  body: (() => { const b = makeStubEl('body'); b._attrs['data-ds-dark-theme'] = ''; return b })(),
  documentElement: { getAttribute: () => null, setAttribute() {} },
  getElementById: (id) => byId.get(id) || null,
  createElement: (tag) => makeStubEl(tag),
  createDocumentFragment: () => makeStubEl('fragment'),
  head: { appendChild: (el) => headChildren.push(el) },
  querySelectorAll: (sel) => (sel === '[role="dialog"] nav button' ? [navRow] : []),
};

// eval the bundle in this global context
new Function('window', 'document', src)(globalThis.window, globalThis.document);
check(!!loaderPayload, 'loader payload captured');
check(loaderPayload?.id === 'dsh-official-usage', 'payload id matches', String(loaderPayload?.id));

const mod = loaderPayload.factory(fakeRequire);
check(mod?.name === 'dsh-official-usage', 'factory returns module name');
check(Array.isArray(mod?.inject) && mod.inject.includes('slots'), "module inject includes 'slots'");
check(Array.isArray(mod?.inject) && mod.inject.includes('theme'), "module inject includes 'theme'");

globalThis.__themeSnapshot = null;
globalThis.__themeChangeCb = null;
const ctx = {
  effect(fn) { const d = fn(); effectFn = fn; return d },
  on(event, cb) { if (event === 'theme/change') globalThis.__themeChangeCb = cb; return () => { globalThis.__themeChangeCb = null } },
  theme: { getTheme: () => globalThis.__themeSnapshot },
  slots: {
    inject(slot, register) { return register() },
    register(options, component) { registered = { options, component }; return () => {} },
  },
};
let threw = null;
try { mod.apply(ctx) } catch (e) { threw = e }
check(!threw, 'apply() does not throw', threw ? String(threw.message) : '');
check(!!effectFn, 'apply used ctx.effect (disposable registration)');
check(registered?.options?.name === 'settings.section', 'registered into settings.section');
check(registered?.options?.id === 'official-usage-settings', 'section id', String(registered?.options?.id));
check(typeof registered?.options?.label === 'function', 'label is a function');
check(registered?.options?.label() === '平台用量', 'label text', String(registered?.options?.label?.()));
check(typeof registered?.component === 'function', 'component is a function (React component)');

// 导航图标补丁真的跑了吗：样式进 head + 正确的行被打上标记
const navStyle = headChildren.find(el => el.id === 'dou-nav-icon-style');
check(!!navStyle, '图标样式表已注入 document.head');
check(/mask-image/.test(String(navStyle?.textContent)), '样式表里含 mask-image 规则');
check(navRow._attrs['data-dou-nav-icon'] === '', '导航行「平台用量」被打上图标标记（齿轮被隐藏）');
check(observerCallback !== null, 'MutationObserver 已挂上（设置页重渲染后仍能打标记）');
navRow.textContent = '别的分区';
observerCallback();
check(navRow._attrs['data-dou-nav-icon'] === undefined, 'label 不匹配时标记会被摘掉（幂等）');

console.log('\n--- C. mount the component (shadow DOM) ---');
try {
  const el = registered.component();
  check(el?.type === 'div', 'component returns a host div（不再是 iframe）', String(el?.type));
  check(el?.props?.className === 'dou-host', 'host div carries the panel class', String(el?.props?.className));
  check(!!el?.props?.ref, 'host div carries a ref（挂载点）');

  // React 语义：effect 在元素落到 DOM 之后跑 —— 这里手动执行
  const host = makeStubEl('div');
  el.props.ref.current = host;
  const cleanup = effectFn();
  check(typeof cleanup === 'function', 'effect returns a cleanup function');

  const root = host.shadowRoot;
  check(!!root, 'shadow root attached');
  const styleEl = root.children.find(c => c._attrs['data-ou'] === 'style');
  check(!!styleEl, 'panel <style> injected into the shadow root');
  check(/:host\{display:block;background:transparent/.test(String(styleEl?.textContent)), '注入的样式是 shadow 版（:host 透明画布 + 宿主文字色）');
  check(!/:root\{/.test(String(styleEl?.textContent)), '样式里已经没有 :root 选择器');
  const holder = root.children.find(c => /official-usage-root/.test(String(c.innerHTML)));
  check(!!holder, 'panel markup injected into the shadow root');
  const painted = host.__ouPainted;
  check(!!painted && painted.holder === holder, '面板脚本的根是 holder（重铺时事件委托随之作废）');
  check(typeof painted?.api?.__officialUsageSetData === 'function', 'panel script ran and exposed its API');

  check(host._attrs['data-theme'] === 'dark', '深色标记镜像到宿主元素（body[data-ds-dark-theme]）', String(host._attrs['data-theme']));
  document.body._attrs['data-we-wallpaper'] = '';
  globalThis.__themeChangeCb && globalThis.__themeChangeCb();
  check(host._attrs['data-we'] === '', '壁纸标记镜像到宿主元素（data-we）');
  delete document.body._attrs['data-we-wallpaper'];
  observerCallback && observerCallback();   // 宿主属性变化 → 重新同步
  check(host._attrs['data-we'] === undefined, '壁纸关掉后标记被摘掉');
  delete document.body._attrs['data-ds-dark-theme'];
  observerCallback && observerCallback();
  check(host._attrs['data-theme'] === 'light', '宿主切亮色后面板跟随', String(host._attrs['data-theme']));
  document.body._attrs['data-ds-dark-theme'] = '';

  check(observedTarget === document.body, 'MutationObserver 盯的是 document.body 的属性');
  check(fetchCalls.some(c => String(c.url).startsWith('/dsh-official-usage/api/state')), '挂载时向宿主取数', fetchCalls.map(c => c.url).join(', '));
  check(fetchCalls.some(c => String(c.url).startsWith('/dsh-official-usage/panel-assets.json')), '挂载时拉运行时资产（外观免重启）');
  check(intervals.filter(Boolean).length === 2, '有两个定时器：主题标记同步 + 数据保鲜（共 ' + intervals.filter(Boolean).length + ' 个）');

  // 资产拉回来：版本一致 → 什么都不用动；数据交付给面板
  const EMBEDDED_JS_REV = (src.match(/var PANEL_JS_REV = "([0-9a-f]+)"/) || [])[1];
  const EMBEDDED_CSS_REV = (src.match(/var PANEL_CSS_REV = "([0-9a-f]+)"/) || [])[1];
  check(!!EMBEDDED_JS_REV && !!EMBEDDED_CSS_REV, '产物里带了 CSS/JS 版本号', `css=${EMBEDDED_CSS_REV} js=${EMBEDDED_JS_REV}`);
  ASSETS_FIXTURE = { rev: 'same', cssRev: EMBEDDED_CSS_REV, jsRev: EMBEDDED_JS_REV, css: '/* embedded */', html: '<div id="official-usage-root"></div>' };
  let delivered = null;
  const api = host.__ouPainted.api;
  const orig = api.__officialUsageSetData;
  api.__officialUsageSetData = (d) => { delivered = d; return orig.call(api, d) };
  await flushFetch();
  check(delivered === FETCH_FIXTURE, '取到的数据交给面板（__officialUsageSetData）');
  check(host.__ouPainted === painted, '版本一致时不重铺（省一次 DOM 重建）');

  // ---- 数据保鲜：定时器到点时，数据新鲜就只重取缓存，过期就先让宿主重采 ----
  const tick = () => intervals.forEach((fn) => fn && fn());
  FETCH_FIXTURE.generatedAt = new Date().toISOString();
  host.__ouPainted.generatedAt = FETCH_FIXTURE.generatedAt;
  fetchCalls = [];
  tick();
  await flushFetch();
  check(fetchCalls.some(c => c.url.startsWith('/dsh-official-usage/api/state')), '定时器会重取数据（新格子/新绿色会自己出现）');
  check(!fetchCalls.some(c => c.url.startsWith('/dsh-official-usage/api/refresh')), '数据还新鲜时不去打扰平台接口');

  FETCH_FIXTURE.generatedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  host.__ouPainted.generatedAt = FETCH_FIXTURE.generatedAt;
  fetchCalls = [];
  tick();
  await flushFetch();
  check(fetchCalls.some(c => c.url.startsWith('/dsh-official-usage/api/refresh')), '数据过期时先让宿主重采，再取回');
  check(fetchCalls.some(c => c.url.startsWith('/dsh-official-usage/api/state')), '重采后把新数据交给面板');

  // 版本不一致、但脚本版本一致 → 整块重铺：这就是「改外观不用重启」那条路
  ASSETS_FIXTURE = { rev: 'new', cssRev: 'newcss123456', jsRev: EMBEDDED_JS_REV, css: '/* refreshed-css */', html: '<div id="official-usage-root"></div><div id="tip"></div>' };
  const el2 = registered.component();
  const host2 = makeStubEl('div');
  el2.props.ref.current = host2;
  const cleanup2 = effectFn();
  check(!!host2.__ouPainted, '第二个宿主也铺上了面板');
  const paintedBefore = host2.__ouPainted;
  await flushFetch();
  check(host2.__ouPainted !== paintedBefore, '资产版本变了 → 面板重铺（外观免重启）');
  const styleEl2 = host2.__ouPainted.root.children.find(c => c._attrs['data-ou'] === 'style');
  check(String(styleEl2?.textContent).includes('refreshed-css'), '新 CSS 已生效', String(styleEl2?.textContent).slice(0, 40));
  check(typeof host2.__ouPainted.api?.__officialUsageSetData === 'function', '重铺后脚本重新跑过，API 仍在');
  if (typeof cleanup2 === 'function') cleanup2();

  cleanup();
  check(observerDisconnected, 'cleanup 断开 MutationObserver');
  check(intervals.filter(Boolean).length === 0, 'cleanup 清掉轮询定时器');
} catch (e) {
  check(false, 'component mounts', String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
}

console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'}`);
process.exit(fails === 0 ? 0 : 1);
