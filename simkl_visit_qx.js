/**
 * Simkl Visit for Quantumult X
 *
 * 只使用 QuantumultX 原生脚本 API：$request / $done / $notify / $prefs / $task.fetch
 * 不要把这份脚本用在 Loon / Surge 上，反过来也一样——两边 API 不通用。
 *
 * 1) script-request-header 触发时：从这次请求的 headers 里读出 Cookie 并保存。
 * 2) task_local 定时任务触发时：用保存的 Cookie 重新访问一次首页。
 */

const CONFIG = {
  cookieKey: 'simkl_cookie',
  headerKey: 'simkl_header_profile',
  lastRunKey: 'simkl_last_run',
  visitUrl: 'https://simkl.com/',
  timeoutMs: 15000,
  fallbackUserAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

function notify(title, subtitle, body) {
  try {
    $notify(title, subtitle || '', body || '');
  } catch (_) {}
}

function nowISO() {
  return new Date().toISOString();
}

function getHeader(headers, name) {
  if (!headers) return undefined;
  if (headers[name] !== undefined) return headers[name];
  const target = name.toLowerCase();
  const key = Object.keys(headers).find((k) => k.toLowerCase() === target);
  return key ? headers[key] : undefined;
}

function saveCookieFromRequest() {
  const headers = ($request && $request.headers) || {};
  const cookie = getHeader(headers, 'Cookie');

  // 调试日志：确认脚本被触发、看到的 URL、以及 headers 里到底有没有 Cookie
  console.log(`[Simkl][debug] url=${$request && $request.url}`);
  console.log(`[Simkl][debug] headers=${JSON.stringify(headers)}`);

  if (!cookie) {
    console.log('[Simkl] No Cookie header found.');
    notify('Simkl 未捕获到 Cookie', '请求头里没有 Cookie', '请确认已用 Safari 登录 simkl.com，且 MITM 证书已安装并信任。');
    return $done({});
  }

  const profile = {
    'User-Agent': getHeader(headers, 'User-Agent') || CONFIG.fallbackUserAgent,
    Accept: getHeader(headers, 'Accept') || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': getHeader(headers, 'Accept-Language') || 'zh-CN,zh-Hans;q=0.9,en;q=0.8',
    'Sec-Fetch-Dest': getHeader(headers, 'Sec-Fetch-Dest') || 'document',
    'Sec-Fetch-Mode': getHeader(headers, 'Sec-Fetch-Mode') || 'navigate',
    'Sec-Fetch-Site': getHeader(headers, 'Sec-Fetch-Site') || 'none',
    'Upgrade-Insecure-Requests': getHeader(headers, 'Upgrade-Insecure-Requests') || '1',
  };

  const oldCookie = $prefs.valueForKey(CONFIG.cookieKey) || '';
  $prefs.setValueForKey(cookie, CONFIG.cookieKey);
  $prefs.setValueForKey(JSON.stringify(profile), CONFIG.headerKey);

  const hasCf = /(?:^|;\s*)cf_clearance=/.test(cookie);
  const changed = cookie !== oldCookie;

  console.log(`[Simkl] Cookie ${changed ? 'saved' : 'unchanged'}; length=${cookie.length}; has_cf_clearance=${hasCf}`);
  notify(
    changed ? 'Simkl Cookie 已更新' : 'Simkl Cookie 已刷新',
    hasCf ? '已保存 Cookie + UA' : '未看到 cf_clearance',
    hasCf ? '现在可运行定时访问测试。' : '如果定时 403，请先在浏览器完整打开网站并通过验证后再捕获。'
  );

  // script-request-header 类型：$done({}) 表示不修改这次请求，正常放行
  $done({});
}

function runVisit() {
  const cookie = $prefs.valueForKey(CONFIG.cookieKey);
  if (!cookie) {
    notify('Simkl 访问失败', '未找到 Cookie', '先用浏览器打开 https://simkl.com/ 让脚本捕获 Cookie。');
    console.log('[Simkl] Missing cookie.');
    return $done();
  }

  let profile = {};
  try {
    profile = JSON.parse($prefs.valueForKey(CONFIG.headerKey) || '{}');
  } catch (_) {
    profile = {};
  }

  const requestHeaders = Object.assign(
    {
      'User-Agent': CONFIG.fallbackUserAgent,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh-Hans;q=0.9,en;q=0.8',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Upgrade-Insecure-Requests': '1',
    },
    profile,
    {
      Cookie: cookie,
      Referer: 'https://simkl.com/',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    }
  );

  const request = {
    url: CONFIG.visitUrl,
    method: 'GET',
    timeout: CONFIG.timeoutMs,
    headers: requestHeaders,
  };

  console.log(`[Simkl] Visiting ${CONFIG.visitUrl}; has_cf_clearance=${/(?:^|;\s*)cf_clearance=/.test(cookie)}`);

  $task.fetch(request).then(
    (response) => {
      const status = response && response.statusCode ? response.statusCode : 0;
      const body = response && response.body ? String(response.body) : '';
      const snippet = body.slice(0, 260).replace(/\s+/g, ' ');
      const ok = status >= 200 && status < 400;

      $prefs.setValueForKey(nowISO(), CONFIG.lastRunKey);

      console.log(`[Simkl] Visit finished. status=${status}, bodyLength=${body.length}`);
      if (!ok) console.log(`[Simkl] Body snippet: ${snippet}`);

      if (status === 403) {
        notify('Simkl 访问异常', 'HTTP 403', '多半是 Cloudflare/站点风控拦截后台请求；请重新捕获 Cookie。');
      } else {
        notify(ok ? 'Simkl 访问成功' : 'Simkl 访问异常', `HTTP ${status}`, ok ? `完成时间：${nowISO()}` : '如登录失效，请重新捕获 Cookie。');
      }
      $done();
    },
    (reason) => {
      console.log(`[Simkl] Request error: ${JSON.stringify(reason)}`);
      notify('Simkl 访问失败', '网络请求出错', String(reason));
      $done();
    }
  );
}

if (typeof $request !== 'undefined' && $request && $request.headers) {
  saveCookieFromRequest();
} else {
  runVisit();
}
