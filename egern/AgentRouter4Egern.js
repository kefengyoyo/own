/**
 * AgentRouter 自动签到 for Egern（原生 ctx 风格）
 * ================================================================
 * 版本：v3.0.0
 * 日期：2026-09-11
 * 作者：𝗽𝗮𝗻𝗱𝗮𝕏
 * 风格：Egern 原生 ctx（export default main + ctx.env）
 *
 * 【签到原理】
 * AgentRouter 无独立签到接口，签到挂在登录上：
 *   POST /api/user/login → 响应 data.checked_in === true 即本次登录触发签到
 *   （$25 Credit 已到账）；false 表示今日已签过。
 * 不需要退出重登，不影响其他设备已登录的会话（服务端多会话并存）。
 *
 * 【参数来源】ctx.env（模块解析时由 {{{AR_XXX}}} 占位符替换注入）
 *   AR_ACCOUNT    必填  账号#密码       例："a@x.com#Passw0rd"
 *                        多账号用 | 分隔  例："a@x.com#pwd1|b@x.com#pwd2"
 *                        别名用 @ 前缀    例："主号@a@x.com#pwd1"
 *   AR_BASE_URL   可选  默认 https://agentrouter.org
 *   AR_POLICY     可选  代理策略，留空按分流
 *   AR_TIMEOUT    可选  单请求超时秒数，默认 20
 *   AR_VERIFY     可选  true/false，核验签到日志，默认 true
 *   AR_NOTIFY     可选  always/change/fail，通知策略，默认 always
 *   AR_SHOW_COOKIE 可选 true/false，通知显示 session Cookie，默认 false
 *
 * 兜底：无 $argument/ctx.env 时读下方 CONFIG（平时留空）
 * ================================================================
 */

const VERSION = 'v3.0.0 (2026-09-11)';

// 直接运行时兜底（平时留空，账号只放模块 compat_arguments）
const CONFIG = {
  account: '',
  baseUrl: 'https://agentrouter.org',
  policy: '',
  timeoutSeconds: 20,
  verifyLog: true,
  notify: 'always',
  showCookie: false,
};

const LOGIN_PATH = '/api/user/login';
const SELF_PATH = '/api/user/self';
const LOG_PATH = '/api/log/self/';
const CHECKIN_LOG_TYPE = 4;
const QUOTA_PER_DOLLAR = 500000;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

/* ==================== 工具函数 ==================== */

const pad2 = (n) => String(n).padStart(2, '0');

function nowStamp() {
  const d = new Date();
  return (
    d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
    ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
  );
}

function todayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? '$' + n.toFixed(2) : '未知';
}

function toDollar(quota) {
  const n = Number(quota);
  return Number.isFinite(n) ? Math.round((n / QUOTA_PER_DOLLAR) * 100) / 100 : null;
}

function errMsg(e) {
  if (!e) return '未知错误';
  return String(e.message || e.error || JSON.stringify(e));
}

/** 解析 ACCOUNT 配置串 → [{name, username, password}] */
function parseAccounts(raw) {
  const list = [];
  String(raw || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((item, idx) => {
      const cut = item.indexOf('#'); // 第一个 # 前是账号，密码可含 #
      if (cut <= 0) return;
      let account = item.slice(0, cut).trim();
      const password = item.slice(cut + 1).trim();
      if (!account || !password) return;
      let name = '';
      const at = account.indexOf('@');
      const lastAt = account.lastIndexOf('@');
      if (at > 0 && lastAt > at) {
        name = account.slice(0, at).trim();
        account = account.slice(at + 1).trim();
      }
      list.push({ name: name || account || '账号' + (idx + 1), username: account, password });
    });
  return list;
}

/** 从响应头提取 Cookie（兼容 Headers 对象与普通对象） */
function pickCookie(headers) {
  if (!headers) return '';
  let raw = [];
  try {
    if (typeof headers.getAll === 'function') {
      raw = headers.getAll('set-cookie');
    } else {
      raw = [].concat(headers['set-cookie'] || headers['Set-Cookie'] || []);
    }
  } catch (_) { /* 忽略 */ }
  const jar = {};
  raw.filter(Boolean).forEach((line) => {
    String(line).split(/,(?=[^;=]+=[^;]*)/).forEach((piece) => {
      const kv = String(piece).split(';')[0].trim();
      const eq = kv.indexOf('=');
      if (eq <= 0) return;
      const k = kv.slice(0, eq).trim();
      const v = kv.slice(eq + 1).trim();
      if (k && !/^(path|domain|expires|max-age|samesite|secure|httponly)$/i.test(k)) {
        jar[k] = v;
      }
    });
  });
  return Object.keys(jar).map((k) => k + '=' + jar[k]).join('; ');
}

/* ==================== 配置解析 ==================== */

function getConfig(ctx) {
  const env = (ctx && ctx.env) || {};
  const hasEnv = Object.keys(env).length > 0;
  const pick = (k, def) => {
    const v = env[k] !== undefined && env[k] !== '' ? env[k] : CONFIG[k];
    return v !== undefined && v !== '' ? v : def;
  };
  return {
    source: hasEnv ? '模块参数(ctx.env)' : '脚本内置(CONFIG)',
    accounts: env.AR_ACCOUNT || CONFIG.account || '',
    baseUrl: String(pick('AR_BASE_URL', 'https://agentrouter.org')).replace(/\/+$/, ''),
    policy: String(pick('AR_POLICY', '')),
    timeout: Number(pick('AR_TIMEOUT', 20)) > 0 ? Number(pick('AR_TIMEOUT', 20)) : 20,
    verify: String(pick('AR_VERIFY', 'true')).toLowerCase() !== 'false',
    notify: String(pick('AR_NOTIFY', 'always')).toLowerCase(),
    showCookie: String(pick('AR_SHOW_COOKIE', 'false')).toLowerCase() === 'true',
  };
}

/* ==================== 业务步骤（ctx.http） ==================== */

/** 登录（= 触发签到），返回 {data, cookie} */
async function login(ctx, cfg, acc) {
  const resp = await ctx.http.post(
    cfg.baseUrl + LOGIN_PATH,
    {
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Origin: cfg.baseUrl,
        Referer: cfg.baseUrl + '/login',
        'Cache-Control': 'no-store',
      },
      body: { username: acc.username, password: acc.password },
      timeout: cfg.timeout * 1000,
      credentials: 'omit',
      redirect: 'follow',
      policy: cfg.policy || undefined,
    }
  );
  const cookie = pickCookie(resp.headers);
  const json = await readJson(resp, '登录接口');
  if (!json.success) {
    throw new Error(String(json.message || '登录失败').replace(/[\r\n]+/g, ' '));
  }
  return { data: json.data || {}, cookie };
}

/** 统一解析 JSON，拦截 WAF 的 HTML */
async function readJson(resp, label) {
  const ct = String(resp.headers.get('content-type') || '').toLowerCase();
  const text = await resp.text();
  if (ct.indexOf('text/html') >= 0 || /^\s*</.test(text)) {
    throw new Error(label + ' 返回 HTML（HTTP ' + resp.status + '），可能被 WAF 拦截或域名不可达');
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error(label + ' 返回非 JSON（HTTP ' + resp.status + '）: ' + text.slice(0, 80));
  }
}

/** 查询额度 */
async function fetchQuota(ctx, cfg, cookie, userId, fallback) {
  const out = {
    remaining: toDollar(fallback && fallback.quota),
    used: toDollar(fallback && fallback.used_quota),
    source: 'login',
  };
  if (!cookie) return out;
  try {
    const headers = {
      'User-Agent': UA,
      Accept: 'application/json',
      'Cache-Control': 'no-store',
    };
    if (cookie) headers.Cookie = cookie;
    if (userId) headers['New-API-User'] = String(userId);
    const resp = await ctx.http.get(cfg.baseUrl + SELF_PATH, {
      headers,
      timeout: cfg.timeout * 1000,
      credentials: 'omit',
      redirect: 'follow',
      policy: cfg.policy || undefined,
    });
    const json = await readJson(resp, '用户信息接口');
    if (json.success && json.data) {
      out.remaining = toDollar(json.data.quota);
      out.used = toDollar(json.data.used_quota);
      out.source = 'self';
    }
  } catch (_) { /* 拿不到就用登录响应里的值 */ }
  return out;
}

/** 核验今日签到日志（type=4） */
async function verifyLog(ctx, cfg, cookie, userId) {
  if (!cookie) return { ok: false, detail: '无 Cookie，跳过核验' };
  try {
    const start = Math.floor(new Date(todayKey() + 'T00:00:00').getTime() / 1000);
    const url =
      cfg.baseUrl + LOG_PATH +
      '?p=1&page_size=20&type=' + CHECKIN_LOG_TYPE +
      '&start_timestamp=' + start + '&end_timestamp=' + Math.floor(Date.now() / 1000);
    const headers = { 'User-Agent': UA, Accept: 'application/json', 'Cache-Control': 'no-store' };
    if (cookie) headers.Cookie = cookie;
    if (userId) headers['New-API-User'] = String(userId);
    const resp = await ctx.http.get(url, {
      headers,
      timeout: cfg.timeout * 1000,
      credentials: 'omit',
      redirect: 'follow',
      policy: cfg.policy || undefined,
    });
    const json = await readJson(resp, '日志接口');
    const items = (json.data && (json.data.items || json.data)) || [];
    const list = Array.isArray(items) ? items : [];
    const hit = list.find((it) => Number(it.created_at || it.timestamp || 0) >= start);
    if (hit) {
      const gain = toDollar(hit.quota);
      return { ok: true, detail: '今日签到日志已确认' + (gain ? '，+' + money(gain) : '') };
    }
    return { ok: false, detail: '未查到今日签到日志' };
  } catch (e) {
    return { ok: false, detail: '日志核验失败: ' + errMsg(e) };
  }
}

/** 单账号完整流程 */
async function runAccount(ctx, cfg, acc) {
  const r = { name: acc.name, status: 'fail', message: '', quota: null, used: null, cookie: '' };
  try {
    const { data, cookie } = await login(ctx, cfg, acc);
    r.cookie = cookie;
    r.name = data.username || data.display_name || acc.name;

    const checked = Boolean(data.checked_in);
    const q = await fetchQuota(ctx, cfg, cookie, data.id, data);
    r.quota = q.remaining;
    r.used = q.used;

    if (checked) {
      r.status = 'success';
      r.message = '签到成功，额度已到账';
      if (cfg.verify) {
        const v = await verifyLog(ctx, cfg, cookie, data.id);
        r.message += '（' + v.detail + '）';
      }
    } else {
      r.status = 'already';
      r.message = '今日已签到，无需重复操作';
    }

    if (cookie) {
      ctx.storage.setJSON('agentrouter_cookie_' + acc.username, {
        cookie,
        userId: data.id,
        date: todayKey(),
        updatedAt: nowStamp(),
      });
    }
  } catch (e) {
    r.status = 'fail';
    r.message = errMsg(e);
  }
  return r;
}

/* ==================== 主入口（原生 ctx） ==================== */

export default async function (ctx) {
  const cfg = getConfig(ctx);
  const accounts = parseAccounts(cfg.accounts);

  if (!accounts.length) {
    ctx.notify({
      title: 'AgentRouter 签到',
      subtitle: '配置缺失',
      body: '请在模块「编辑模板参数」填写 AR_ACCOUNT："账号#密码"，多账号用 | 分隔。\n' + VERSION,
    });
    return;
  }

  const results = [];
  for (const acc of accounts) {
    results.push(await runAccount(ctx, cfg, acc));
  }

  const icon = { success: '✅', already: '🟡', fail: '❌' };
  const lines = results.map((r) => {
    let s = icon[r.status] + ' ' + r.name + '\n' + r.message;
    if (r.quota !== null || r.used !== null) {
      s += '\n剩余 ' + money(r.quota) + '｜已用 ' + money(r.used);
    }
    if (cfg.showCookie && r.cookie) s += '\nCookie: ' + r.cookie;
    return s;
  });

  const okCount = results.filter((r) => r.status === 'success').length;
  const alreadyCount = results.filter((r) => r.status === 'already').length;
  const failCount = results.filter((r) => r.status === 'fail').length;
  const subtitle = '成功 ' + okCount + '｜已签 ' + alreadyCount + '｜失败 ' + failCount;

  const shouldNotify =
    cfg.notify === 'always' ||
    (cfg.notify === 'fail' && failCount > 0) ||
    (cfg.notify === 'change' && (okCount > 0 || failCount > 0));

  if (shouldNotify) {
    ctx.notify({
      title: 'AgentRouter 签到',
      subtitle,
      body: lines.join('\n\n') + '\n\n参数来源: ' + cfg.source + '\n🕐 ' + nowStamp() + '　' + VERSION,
      sound: failCount > 0,
    });
  }
}
