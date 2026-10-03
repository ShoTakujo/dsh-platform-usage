
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
  const lastD = new Date(DATA.window.end+'T00:00:00');
  const dw = (lastD.getDay()+6)%7;
  const lastMon = new Date(lastD.getTime()-dw*DAY);
  const firstMon = new Date(lastMon.getTime()-(LV_WEEKS-1)*7*DAY);
  const out=[];
  for(let w=0; w<LV_WEEKS; w++){
    const days=[];
    for(let d=0; d<7; d++){
      const dt=new Date(firstMon.getTime()+(w*7+d)*DAY);
      const iso=dt.toISOString().slice(0,10);
      days.push({ date:iso, dt, future: dt>lastD, rec: byDate.get(iso) || null });
    }
    out.push(days);
  }
  return out;
}
const DAY = 86400000;
const fmt = {
  tok(n){ if(n>=1e9) return (n/1e9).toFixed(2)+'B'; if(n>=1e6) return (n/1e6).toFixed(1)+'M';
          if(n>=1e3) return (n/1e3).toFixed(1)+'K'; return String(n); },
  tokFull(n){ return n.toLocaleString('zh-CN'); },
  money(c){ return '¥'+c.toFixed(2); },
  date(s){ const [y,m,d]=s.split('-'); return `${y}年${+m}月${+d}日`; },
};

// intensity levels, absolute thresholds (Codex style: visually comparable across the year)
const LV = [1e6, 1e7, 5e7, 1e8];
function level(v){ if(!v) return 0; for(let i=0;i<LV.length;i++) if(v<LV[i]) return i+1; return 5; }

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
    const m = w[0].dt.getMonth();
    // 离上一个标签不足 3 列就不标，免得挤在一起
    if(m!==prevM && i<52 && (i-lastLabelWeek)>=3){
      const s=document.createElement('span');
      s.textContent = (prevM===null ? w[0].dt.getFullYear()+'年' : '') + (m+1)+'月';
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
      if(!d.future){ c.classList.add('l'+level(v)); }
      else { c.style.background='transparent'; c.style.boxShadow='inset 0 0 0 1px var(--line)'; }
      if(!d.future && (v>0 || d.rec)){
        c.dataset.tip='1';
        const weekly = weekTokenSum(w);
        c.dataset.text = d.rec
          ? `${fmt.date(d.date)}<br>${fmt.tokFull(d.rec.tokens)} tokens · ${d.rec.requests} 次请求<br>花费 ${fmt.money(d.rec.cost)}<br>缓存命中 ${fmt.tok(d.rec.cacheHit)} / 新增 ${fmt.tok(d.rec.cacheMiss)}`
          : `${fmt.date(d.date)}<br>无使用`;
        c.dataset.text += mode==='weekly' ? `<br><b>本周 ${fmt.tok(weekly)}</b>` : '';
        c.dataset.text += mode==='cumulative' ? `<br><b>截至此日累计 ${fmt.tok(cum.get(d.date)||0)}</b>` : '';
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

  document.getElementById('lgL').textContent = mode==='cumulative' ? '少' : '<1M';
  document.getElementById('lgR').textContent = mode==='cumulative' ? fmt.tok(acc) : '≥100M';
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
document.addEventListener('mouseover', e=>{
  const c=e.target.closest('.c[data-tip]'); if(!c) return;
  tip.innerHTML=c.dataset.text; tip.classList.add('on');
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
  if(e.target.closest('.c[data-tip]')) tip.classList.remove('on');
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
