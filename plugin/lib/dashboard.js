
/* 数据来源：
   · 独立文件模式 —— 上方 <script type="application/json"> 里烤好的数据
   · 插件模式    —— 宿主给 window.__OFFICIAL_USAGE_DATA__（下一行就是消费点）
   ⚠️ 插件模式下这一步绝不能碰 DOM：后面的交互绑定依赖完整 DOM，
      早期版本在这里写了一句“暂无数据”把 .wrap 换掉，直接让脚本崩在
      getElementById('modes') === null 上。 */
var __OU_PLUGIN__ = (typeof __OU_PLUGIN__ !== 'undefined');
var __OU_DATA__ = null;
if(!__OU_PLUGIN__){
  try {
    var __ouRaw = document.getElementById('payload').textContent;
    if(__ouRaw && __ouRaw.trim().charAt(0)==='{') __OU_DATA__ = JSON.parse(__ouRaw);
  } catch(e){ /* 无内嵌数据 */ }
  if(!__OU_DATA__) __OU_DATA__ = window.__OFFICIAL_USAGE_DATA__ || null;
}

const DOM = { root: document.getElementById('official-usage-root') };

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
  const months = document.getElementById('months');
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
  const cols=document.getElementById('cols');
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
  document.getElementById('stats').innerHTML = `
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
  const colsEl = document.getElementById('cols');
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
  const g = document.getElementById('gridbox');
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
  const el = document.getElementById(id); if(!el) return;
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
  document.getElementById('bykey').innerHTML = table(DATA.apiKeys,'API Key');
  document.getElementById('bymodel').innerHTML = table(DATA.models,'模型');
}

// interactions
document.getElementById('modes').addEventListener('click', e=>{
  const b=e.target.closest('button'); if(!b) return;
  // 刷新键现在也住在这个胶囊里，点它不能当成切换视图
  if(!b.dataset.m) return;
  [...e.currentTarget.children].forEach(x=>x.classList.toggle('on', x===b));
  state.mode=b.dataset.m; render();
});
const tip=document.getElementById('tip');

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

document.addEventListener('mouseover', e=>{
  const c=e.target.closest('.c[data-tip]'); if(!c) return;
  tip.innerHTML=c.dataset.text; showTip();
});
document.addEventListener('mousemove', e=>{
  if(!tip.classList.contains('on')) return;
  const pad=14; let x=e.clientX+pad, y=e.clientY+pad;
  const r=tip.getBoundingClientRect();
  if(x+r.width>innerWidth-8) x=e.clientX-r.width-pad;
  if(y+r.height>innerHeight-8) y=e.clientY-r.height-pad;
  tip.style.left=x+'px'; tip.style.top=y+'px';
});
document.addEventListener('mouseout', e=>{
  if(e.target.closest('.c[data-tip]')) hideTip();
});

// 刷新：先让宿主强刷（跳过它那份 10 分钟缓存），再取回新数据重画
// 独立文件模式下没有宿主路由，按钮仍然在，取不到就提示一下。
var REFRESH_URL = (typeof __OU_REFRESH_URL__ !== 'undefined') ? __OU_REFRESH_URL__ : '/dsh-official-usage/api/refresh';
var STATE_URL = (typeof __OU_STATE_URL__ !== 'undefined') ? __OU_STATE_URL__ : '/dsh-official-usage/api/state';
function refreshNow(){
  var btn = document.getElementById('refresh');
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
var _rb = document.getElementById('refresh');
if(_rb) _rb.addEventListener('click', refreshNow);

// 宿主用：宿主把数据交给面板（插件模式）
window.__officialUsageMount = function(payload){ if(payload) bootstrap(payload); };
window.__officialUsageSetData = function(payload){ bootstrap(payload); };
window.__officialUsageRefresh = refreshNow;

if(!__OU_PLUGIN__){
  render(); renderTables();       // 独立文件模式：数据已内嵌
}
