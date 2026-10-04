/**
 * dsh-official-usage —— host 侧
 *
 * 把 DeepSeek 开放平台「官方账号口径」的用量拉进 DSH：
 *   GET /dsh-official-usage/api/state    逐日 token/费用（按 API Key × 模型分桶，全账号）
 *   GET /dsh-official-usage/api/balance  实时余额 + token 是否还有效
 *   GET /dsh-official-usage/api/refresh  强制重新采集（忽略缓存）
 *   GET /dsh-official-usage/panel.html   设置页面板（iframe 内加载，同源，无 CORS 问题）
 *
 * 为什么必须有 host 侧代理：platform.deepseek.com 不返回 CORS 头，浏览器不能直连。
 * 官方接口单次最多查 7 天，所以一年 = 53 次请求，这里并发 4 路并把结果缓存 10 分钟。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import z from '@deepseek-ai/schemastery';

export const name = 'dsh-official-usage';
export const inject = ['webServer'];
export const Config = z.object({
    title: z.string().default('平台用量'),
    weeks: z.number().default(53),
    refreshMinutes: z.number().default(10),
});

const API = '/dsh-official-usage';
const BASE = 'https://platform.deepseek.com';
const DAY = 86400;
const WINDOW_DAYS = 7;
const MAX_CONCURRENCY = 4;

// --------------------------------------------------------------------------
// token：优先环境变量，其次 DSH 凭据文件（codex-meter 用的也是这个位置）
// --------------------------------------------------------------------------
const TOKEN_PATHS = [
    path.join(os.homedir(), '.dsh', '.credentials.yaml'),
    path.join(process.env.DSH_HOME || '', '.credentials.yaml'),
];

function readToken() {
    if (process.env.DEEPSEEK_PLATFORM_TOKEN) return { token: process.env.DEEPSEEK_PLATFORM_TOKEN, from: 'env' };
    for (const p of TOKEN_PATHS) {
        if (!p || !p.includes('.credentials.yaml')) continue;
        try {
            const raw = fs.readFileSync(p, 'utf8');
            const m = /DEEPSEEK_PLATFORM_TOKEN:\s*["']?([A-Za-z0-9+/=_-]{16,})["']?/.exec(raw);
            if (m) return { token: m[1], from: p };
        }
        catch { /* 文件不存在继续试下一个 */ }
    }
    return { token: null, from: null };
}

function headers(token) {
    return {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        origin: BASE,
        referer: `${BASE}/usage`,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    };
}

async function apiJson(pathname, token, tries = 3) {
    for (let i = 0; i < tries; i++) {
        try {
            const ctl = AbortSignal.timeout(25_000);
            const r = await fetch(BASE + pathname, { headers: headers(token), signal: ctl });
            const j = await r.json();
            if (j?.data?.biz_msg === 'INVALID_PARAM') return null;
            if (j?.code === 40002) throw new Error('token 已失效或缺少权限（平台登录态过期）');
            return j?.data?.biz_data ?? j;
        }
        catch (e) {
            if (String(e?.message || '').includes('失效')) throw e;
            if (i === tries - 1) throw e;
            await new Promise(r => setTimeout(r, 400 * (i + 1)));
        }
    }
    return null;
}

// --------------------------------------------------------------------------
// 聚合：按天 × 模型 × API Key
//
// 「一天」的口径 = **东八区**（DeepSeek 开放平台自己的日历口径）。
// 实测（2026-10-04）：接口是按**查询起点所在的那个午夜**来分日的 ——
//   起点给 2026-09-30T16:00Z（= 东八区 10-01 00:00）→ 返回的 4 个日桶都戳在 16:00Z；
//   起点给 2026-10-01T00:00Z（UTC 午夜）    → 同样 4 天，戳都在 00:00Z，数值一一对应。
// 所以只要把窗口按东八区午夜对齐，拿到的就是东八区的「天」；
// 顺带一句：请求里的 tz 参数在这台账号上实测**不影响分桶**（tz=28800 与 tz=0 逐桶相同），
// 真正起作用的是窗口对齐方式，别指望它。
// --------------------------------------------------------------------------
const TZ = 8 * 3600;                                  // 东八区
function dayKey(ts) { return new Date((ts + TZ) * 1000).toISOString().slice(0, 10); }

async function collect(token, weeks) {
    const days = Math.max(1, weeks) * 7;
    const now = Math.floor(Date.now() / 1000);
    const end = Math.ceil((now + TZ) / DAY) * DAY - TZ;   // 下一个东八区午夜（epoch 秒）
    const start = end - days * DAY;

    const windows = [];
    for (let s = start; s < end; s += WINDOW_DAYS * DAY) windows.push([s, Math.min(s + WINDOW_DAYS * DAY, end)]);

    const byDay = new Map();
    const byModel = new Map();
    const byKey = new Map();
    const modelDaily = new Map();

    const bump = (map, k, add, day) => {
        if (!map.has(k)) map.set(k, { total: 0, days: new Map() });
        const rec = map.get(k);
        rec.total += add;
        rec.days.set(day, (rec.days.get(day) || 0) + add);
    };

    let cursor = 0;
    async function worker() {
        while (cursor < windows.length) {
            const [s, e] = windows[cursor++];
            const [amt, cost] = await Promise.all([
                apiJson(`/api/v0/usage/by_api_key/amount?start=${s}&end=${e}&tz=28800`, token),
                apiJson(`/api/v0/usage/by_api_key/cost?start=${s}&end=${e}&tz=28800`, token),
            ]);

            for (const serie of amt?.series ?? []) {
                // key_type（NORMAL / DSH …）不参与显示，只有 key 名字进标签。
                // 需要时仍可从 API 返回里读到，这里刻意不再拼后缀。
                const keyName = serie.api_key?.name ?? '(未命名 Key)';
                const model = serie.model ?? '(未知模型)';
                for (const b of serie.buckets ?? []) {
                    const u = b.usage ?? {};
                    const total = (u.RESPONSE_TOKEN ?? 0) + (u.PROMPT_CACHE_HIT_TOKEN ?? 0) + (u.PROMPT_CACHE_MISS_TOKEN ?? 0);
                    if (!total && !(u.REQUEST ?? 0)) continue;
                    const d = dayKey(b.time);
                    const rec = byDay.get(d) ?? { tokens: 0, out: 0, hit: 0, miss: 0, requests: 0, cost: 0 };
                    rec.tokens += total; rec.out += u.RESPONSE_TOKEN ?? 0;
                    rec.hit += u.PROMPT_CACHE_HIT_TOKEN ?? 0; rec.miss += u.PROMPT_CACHE_MISS_TOKEN ?? 0;
                    rec.requests += u.REQUEST ?? 0;
                    byDay.set(d, rec);
                    bump(byModel, model, total, d);
                    bump(byKey, keyName, total, d);
                    if (!modelDaily.has(model)) modelDaily.set(model, new Map());
                    modelDaily.get(model).set(d, (modelDaily.get(model).get(d) || 0) + total);
                }
            }

            const groups = cost?.data ?? (Array.isArray(cost?.series) ? [{ series: cost.series }] : []);
            for (const g of groups) {
                for (const serie of g?.series ?? []) {
                    for (const b of serie.buckets ?? []) {
                        const c = parseFloat(b.cost ?? '0');
                        if (!c) continue;
                        const d = dayKey(b.time);
                        const rec = byDay.get(d) ?? { tokens: 0, out: 0, hit: 0, miss: 0, requests: 0, cost: 0 };
                        rec.cost += c;
                        byDay.set(d, rec);
                    }
                }
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, windows.length) }, worker));

    const list = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, r]) => ({
        date, tokens: r.tokens, output: r.out, cacheHit: r.hit, cacheMiss: r.miss,
        requests: r.requests, cost: Number(r.cost.toFixed(4)),
    }));

    const flat = (map) => [...map.entries()]
        .map(([k, v]) => ({
            total: v.total,
            activeDays: [...v.days.values()].filter(Boolean).length,
            days: [...v.days.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, tokens]) => ({ date, tokens })),
            name: k,
        }))
        .sort((a, b) => b.total - a.total);

    const peak = list.reduce((best, d) => (d.tokens > (best?.tokens ?? -1) ? d : best), null);
    return {
        generatedAt: new Date().toISOString(),
        window: { start: dayKey(start), end: dayKey(end - DAY) },
        currency: 'CNY',
        totals: {
            tokens: list.reduce((a, d) => a + d.tokens, 0),
            cost: Number(list.reduce((a, d) => a + d.cost, 0).toFixed(4)),
            requests: list.reduce((a, d) => a + d.requests, 0),
            activeDays: list.filter(d => d.tokens > 0).length,
            peakDay: peak,
        },
        apiKeys: flat(byKey),
        models: flat(byModel).map(m => ({ name: m.name, total: m.total, activeDays: m.activeDays })),
        modelDaily: [...modelDaily.entries()].map(([model, days]) => ({
            model, total: [...days.values()].reduce((a, b) => a + b, 0),
            days: [...days.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, tokens]) => ({ date, tokens })),
        })).sort((a, b) => b.total - a.total),
        days: list,
    };
}

async function collectBalance(token) {
    const s = await apiJson('/api/v0/users/get_user_summary', token);
    if (!s) return null;
    let email = null;
    try {
        const me = await apiJson('/auth-api/v0/users/current', token);
        email = me && me.email ? me.email : null;
    }
    catch { /* 余额可用就够了 */ }
    return {
        normal: s.normal_wallets ?? [],
        bonus: s.bonus_wallets ?? [],
        totalCosts: s.total_costs ?? [],
        email,
        checkedAt: new Date().toISOString(),
    };
}

// --------------------------------------------------------------------------
// 缓存
// --------------------------------------------------------------------------
export function apply(ctx, config) {
    const ttlMs = Math.max(1, config.refreshMinutes || 10) * 60_000;
    const weeks = Math.max(4, Math.min(53, config.weeks || 53));
    let cache = null;      // { at, data, balance }
    let inflight = null;

    async function build(force) {
        if (!force && cache && Date.now() - cache.at < ttlMs) return cache;
        if (inflight) return inflight;
        inflight = (async () => {
            const { token, from } = readToken();
            if (!token) {
                const err = new Error('没有找到 DEEPSEEK_PLATFORM_TOKEN（请看 README 的获取步骤）');
                err.code = 'NO_TOKEN';
                throw err;
            }
            const [data, balance] = await Promise.all([collect(token, weeks), collectBalance(token).catch(() => null)]);
            data.balance = balance;
            data.tokenSource = from;
            cache = { at: Date.now(), data, balance };
            return cache;
        })();
        try { return await inflight; }
        finally { inflight = null; }
    }

    ctx.effect(() => ctx.webServer.register({
        kind: 'prefix',
        path: API,
        handler: async (req, res) => {
            const url = req.url || '/';
            const pathname = url.split('?')[0];
            const sub = pathname.startsWith(API) ? pathname.slice(API.length) : pathname;
            const json = (code, body) => {
                res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify(body));
            };
            try {
                if (sub === '/panel.html') {
                    const file = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), 'dashboard.html');
                    const html = fs.readFileSync(file);
                    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(html);
                    return;
                }
                // 面板的运行时资产（CSS/HTML + 两个版本号）：客户端挂载时拉一次，
                // 版本对得上就整块重铺 —— 改外观不用重启 DSH。no-store，永远读磁盘上最新的。
                if (sub === '/panel-assets.json') {
                    const file = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), 'panel-assets.json');
                    try {
                        const body = fs.readFileSync(file);
                        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(body);
                    } catch {
                        json(404, { error: 'panel-assets.json 还没生成：在插件目录跑 node tools/build-panel.mjs' });
                    }
                    return;
                }
                if (sub === '/api/state') {
                    const force = /[?&]fresh=1(?:&|$)/.test(url);
                    const c = await build(force);
                    json(200, c.data);
                    return;
                }
                if (sub === '/api/balance') {
                    const c = await build(false);
                    json(200, c.balance ?? {});
                    return;
                }
                if (sub === '/api/refresh') {
                    const c = await build(true);
                    json(200, { ok: true, generatedAt: c.data.generatedAt, days: c.data.days.length });
                    return;
                }
                json(200, { ok: true, service: name, endpoints: ['/api/state', '/api/balance', '/api/refresh', '/panel.html', '/panel-assets.json'] });
            }
            catch (e) {
                json(500, { error: e?.message ?? 'internal error', code: e?.code ?? null });
            }
        },
    }), 'dsh-official-usage: routes');

    // 预热：让首开就有数据（失败静默，第一次请求会重试并给出原因）
    void build(false).catch(() => { /* 见 /api/state 的错误处理 */ });
}
