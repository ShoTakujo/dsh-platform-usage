// Static + runtime smoke test for the client bundle, before it ever reaches DSH.
//   A) structural guards the host enforces (text checks, copied from the
//      dsh-usage-heatmap findings)
//   B) execute the factory with a fake require/ctx and assert that it registers
//      a React component into the 'settings.section' slot without throwing
import { readFileSync } from 'node:fs';

const WS = 'C:\\Users\\Jiang\\Documents\\deepseek-harness\\default-workspace';
const FILE = `${WS}\\dsh-official-usage\\client\\client.js`;
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
check(/inject:\s*\[[^\]]*'theme'[^\]]*\]/.test(code), "inject 里含 'theme'（用来问宿主当前主题）");
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

console.log('\n--- B. execute the factory ---');
let registered = null;
const fakeReact = {
  createElement: (type, props, ...kids) => ({ $$typeof: 'react.element', type, props, kids }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (v) => ({ current: v }),
};
const fakeRequire = (id) => {
  if (id === 'react') return fakeReact;
  throw new Error('unexpected require: ' + id);
};

let loaderPayload = null;
globalThis.window = {
  __ModuleLoader__: { load: (p) => { loaderPayload = p; } },
  addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: globalThis.__sysDark === true }),
};

// 宿主主题变量：测试里可切换，用来验证客户端是否把它正确传给 iframe
globalThis.__hostBg = 'rgb(255, 255, 255)';
globalThis.__sysDark = false;

// 够用的假 DOM：导航图标补丁和主题探测都要真的跑起来才算验证过
const headChildren = [];
const navRow = {
  _text: '平台用量',
  _attrs: {},
  textContent: '',
  setAttribute(k, v) { this._attrs[k] = v },
  removeAttribute(k) { delete this._attrs[k] },
  querySelectorAll() { return [] },
};
navRow.textContent = navRow._text;
const bodyStub = {
  nodeType: 1,
  appendChild(el) { globalThis.__probeEl = el },
  removeChild(el) { globalThis.__probeEl = null },
};
let observerCallback = null;
let observerDisconnected = false;
globalThis.MutationObserver = class {
  constructor(cb) { observerCallback = cb }
  observe() {}
  disconnect() { observerDisconnected = true }
};
globalThis.queueMicrotask = (fn) => fn();
// 让 getComputedStyle 能区分「根元素」和「探针元素」：
// 探针拿到的是 --hostSampleBg，用来验证「量宿主实际背景」这条兜底
globalThis.getComputedStyle = (el) => ({
  getPropertyValue: (name) => (name === '--dsw-alias-bg-base' ? globalThis.__hostBg : ''),
  backgroundColor: el === globalThis.__probeEl ? (globalThis.__hostSampleBg || 'rgba(0, 0, 0, 0)') : 'rgba(0, 0, 0, 0)',
});
globalThis.document = {
  body: bodyStub,
  documentElement: { getAttribute: () => null, setAttribute() {} },
  getElementById: () => null,
  createElement: () => ({ style: { cssText: '' }, textContent: '', id: '', remove() {}, setAttribute() {} }),
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
check(Array.isArray(mod?.inject) && mod.inject.includes('theme'), "module inject includes 'theme'（宿主主题服务）");

let effectFn = null;
// 宿主 theme 服务的桩：可切换，用来验证客户端优先问它
globalThis.__themeSnapshot = null;
globalThis.__themeChangeCb = null;
const ctx = {
  // real ctx.effect(fn) runs fn and keeps its disposer — the stub must do the same
  effect(fn) { const d = fn(); effectFn = fn; return d; },
  on(event, cb) { if (event === 'theme/change') globalThis.__themeChangeCb = cb; return () => { globalThis.__themeChangeCb = null; }; },
  theme: { getTheme: () => globalThis.__themeSnapshot },
  slots: {
    inject(slot, register) { return register(); },
    register(options, component) { registered = { options, component }; return () => {}; },
  },
};
let threw = null;
try { mod.apply(ctx); } catch (e) { threw = e; }
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
navRow._text = '别的分区';
navRow.textContent = '别的分区';
observerCallback();
check(navRow._attrs['data-dou-nav-icon'] === undefined, 'label 不匹配时标记会被摘掉（幂等）');

// render the component once with the fake React to catch immediate throws
try {
  const el = registered.component();
  // 组件现在直接返回一个 iframe（面板自带标题行与刷新按钮，外面不需要壳）
  check(el?.type === 'iframe', 'component returns the panel iframe', String(el?.type));
  check(String(el?.props?.src).startsWith('/dsh-official-usage/panel.html'), 'iframe points at the host panel route', String(el?.props?.src));
  check(el?.props?.title === '平台用量', 'iframe has a title (a11y)', String(el?.props?.title));

  // 优先级链：theme 服务 > 探针量宿主背景 > CSS 变量 > 系统偏好
  // ① 只有系统偏好
  globalThis.__themeSnapshot = null;
  globalThis.__hostSampleBg = 'rgba(0, 0, 0, 0)'; globalThis.__hostBg = ''; globalThis.__sysDark = true;
  const sysOnly = registered.component();
  check(/[\?&]theme=dark(?:&|$)/.test(sysOnly.props.src), '只有系统偏好时按系统（暗色）', sysOnly.props.src);

  // ② 探针量到宿主实际背景（hex 由浏览器解析后给出 rgb，两种写法都要能算）
  globalThis.__hostSampleBg = 'rgb(255, 255, 255)'; globalThis.__sysDark = true;
  check(/[\?&]theme=light(?:&|$)/.test(registered.component().props.src), '探针量到白色 → light（压过系统暗色）');
  globalThis.__hostSampleBg = 'rgb(22, 24, 28)'; globalThis.__sysDark = false;
  check(/[\?&]theme=dark(?:&|$)/.test(registered.component().props.src), '探针量到深色 → dark（压过系统亮色）');

  // ③ 探针拿不到时退回 CSS 变量；用 hex 测（DSH 真实写法）
  globalThis.__hostSampleBg = 'rgba(0, 0, 0, 0)';
  globalThis.__hostBg = '#f7f8fa'; globalThis.__sysDark = true;
  check(/[\?&]theme=light(?:&|$)/.test(registered.component().props.src), 'CSS 变量 hex 亮色覆盖系统暗色');
  globalThis.__hostBg = '#16181c'; globalThis.__sysDark = false;
  check(/[\?&]theme=dark(?:&|$)/.test(registered.component().props.src), 'CSS 变量 hex 暗色覆盖系统亮色');

  // ④ theme 服务最优先 —— 用宿主的**真实快照形状**：
  //    buildSnapshot() 返回 { preference, fontSize, active, themes, revision }
  //    colorScheme 嵌在 active 里，顶层没有。之前用顶层 colorScheme 测，属于假通过。
  globalThis.__themeSnapshot = {
    preference: 'dark', fontSize: 14, revision: 1, themes: [],
    active: { id: 'dark', colorScheme: 'dark', tokens: {} },
  };
  globalThis.__hostSampleBg = 'rgb(255, 255, 255)'; globalThis.__hostBg = '#f7f8fa'; globalThis.__sysDark = false;
  check(/[\?&]theme=dark(?:&|$)/.test(registered.component().props.src), '真实快照 active.colorScheme=dark → dark（压过探针与变量）');

  // ⑤ preference=system 时，答案是解析后的 active.colorScheme（系统暗 → active.colorScheme=dark）
  globalThis.__themeSnapshot = {
    preference: 'system', fontSize: 14, revision: 2, themes: [],
    active: { id: 'dark', colorScheme: 'dark', tokens: {} },
  };
  check(/[\?&]theme=dark(?:&|$)/.test(registered.component().props.src), 'preference=system 时按 active.colorScheme');

  // ⑥ 只认 active 里的 colorScheme，别被顶层同名字段带偏（顶层 preference 不是答案）
  globalThis.__themeSnapshot = {
    preference: 'light', colorScheme: 'light', themes: [],
    active: { id: 'dark', colorScheme: 'dark', tokens: {} },
  };
  check(/[\?&]theme=dark(?:&|$)/.test(registered.component().props.src), '嵌套 active 优先于顶层同名字段', registered.component().props.src);

  // ⑦ active 只有 id 没 colorScheme 时，用 id 兜底
  globalThis.__themeSnapshot = { preference: 'dark', active: { id: 'dark', tokens: {} } };
  check(/[\?&]theme=dark(?:&|$)/.test(registered.component().props.src), 'active 只有 id 时用 id 兜底');

  globalThis.__themeSnapshot = null;
  globalThis.__hostSampleBg = 'rgba(0, 0, 0, 0)';
  globalThis.__hostBg = 'rgb(255, 255, 255)'; globalThis.__sysDark = false;
} catch (e) { check(false, 'component renders', String(e.message)); }
check(/theme\/change/.test(code), '订阅宿主的 theme/change 事件');
check(/setInterval/.test(code), '拿不到事件时也有轮询兜底');
check(/sampleHostBackground/.test(code), '有「量宿主实际背景」这条兜底');

console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'}`);
process.exit(fails === 0 ? 0 : 1);
