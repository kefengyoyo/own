/**
 * Simkl Visit for Surge
 *
 * What it does:
 * 1) When you open https://simkl.com/ in a browser through Surge, capture your own Cookie + UA/header profile.
 * 2) On cron, replay a lightweight GET request to https://simkl.com/ with that Cookie + same UA profile.
 *
 * Notes:
 * - Only use this for your own Simkl account/session.
 * - This script does not bypass Cloudflare or any anti-bot protection. If the site returns 403 because
 *   of TLS/browser fingerprint checks, a Surge background HTTP client may still be blocked.
 */

const CONFIG = {
  cookieKey: 'simkl_cookie',
  headerKey: 'simkl_header_profile',
  lastRunKey: 'simkl_last_run',
  visitUrl: 'https://simkl.com/',
  timeoutMs: 15000,
  fallbackUserAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

function notify(title, subtitle, body) {
  try { $notification.post(title, subtitle || '', body || ''); } catch (_) {}
}

function done(value) {
  try { $done(value || {}); } catch (_) { $done(); }
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

  // 调试用：把这次触发脚本的请求完整打印出来，方便在 Loon「日志」里核对
  // 1) 脚本确实被触发了（能看到这条日志）
  // 2) $request.url 是不是你以为的那个域名/路径
  // 3) headers 里到底有没有 Cookie 字段（哪怕是别的大小写）
  console.log(`[Simkl][debug] url=${$request && $request.url}`);
  console.log(`[Simkl][debug] headers=${JSON.stringify(headers)}`);

  if (!cookie) {
    console.log('[Simkl] No Cookie header found. Log in/open https://simkl.com/ through Safari (with MITM+证书信任 已开启) first.');
    notify('Simkl 未捕获到 Cookie', '请求头里没有 Cookie', '请确认已在 Safari 用同一网络登录过 simkl.com，且 Loon 证书已信任。');
    return done({});
  }

  // 403 很常见的原因：Cookie 里的 cf_clearance / 登录态和浏览器 UA 绑定。
  // 所以捕获 Cookie 时同时保存原始浏览器 UA 和常见导航头，定时请求时一起复用。
  const profile = {
    'User-Agent': getHeader(headers, 'User-Agent') || CONFIG.fallbackUserAgent,
    'Accept': getHeader(headers, 'Accept') || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': getHeader(headers, 'Accept-Language') || 'zh-CN,zh-Hans;q=0.9,en;q=0.8',
    'Sec-Fetch-Dest': getHeader(headers, 'Sec-Fetch-Dest') || 'document',
    'Sec-Fetch-Mode': getHeader(headers, 'Sec-Fetch-Mode') || 'navigate',
    'Sec-Fetch-Site': getHeader(headers, 'Sec-Fetch-Site') || 'none',
    'Upgrade-Insecure-Requests': getHeader(headers, 'Upgrade-Insecure-Requests') || '1',
  };

  const oldCookie = $persistentStore.read(CONFIG.cookieKey) || '';
  $persistentStore.write(cookie, CONFIG.cookieKey);
  $persistentStore.write(JSON.stringify(profile), CONFIG.headerKey);

  const hasCf = /(?:^|;\s*)cf_clearance=/.test(cookie);
  const changed = cookie !== oldCookie;

  console.log(`[Simkl] Cookie ${changed ? 'saved' : 'unchanged'}; length=${cookie.length}; has_cf_clearance=${hasCf}; ua=${profile['User-Agent']}`);
  notify(
    changed ? 'Simkl Cookie 已更新' : 'Simkl Cookie 已刷新',
    hasCf ? '已保存 Cookie + UA' : '未看到 cf_clearance',
    hasCf ? '现在可运行定时访问测试。' : '如果定时 403，请先在浏览器完整打开网站并通过验证后再捕获。'
  );

  done({});
}

function runVisit() {
  const cookie = $persistentStore.read(CONFIG.cookieKey);
  if (!cookie) {
    notify('Simkl 访问失败', '未找到 Cookie', '先用浏览器打开 https://simkl.com/ 让模块捕获 Cookie。');
    console.log('[Simkl] Missing cookie.');
    return done();
  }

  let profile = {};
  try { profile = JSON.parse($persistentStore.read(CONFIG.headerKey) || '{}'); } catch (_) { profile = {}; }

  const requestHeaders = Object.assign({
    'User-Agent': CONFIG.fallbackUserAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh-Hans;q=0.9,en;q=0.8',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1',
  }, profile, {
    'Cookie': cookie,
    'Referer': 'https://simkl.com/',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  });

  const request = {
    url: CONFIG.visitUrl,
    timeout: CONFIG.timeoutMs,
    headers: requestHeaders,
  };

  console.log(`[Simkl] Visiting ${CONFIG.visitUrl}; ua=${requestHeaders['User-Agent']}; has_cf_clearance=${/(?:^|;\s*)cf_clearance=/.test(cookie)}`);

  $httpClient.get(request, (error, response, data) => {
    if (error) {
      console.log(`[Simkl] Request error: ${JSON.stringify(error)}`);
      notify('Simkl 访问失败', '网络请求出错', String(error));
      return done();
    }

    const status = response && response.status ? response.status : 0;
    const body = data ? String(data) : '';
    const snippet = body.slice(0, 260).replace(/\s+/g, ' ');
    const ok = status >= 200 && status < 400;

    $persistentStore.write(nowISO(), CONFIG.lastRunKey);

    console.log(`[Simkl] Visit finished. status=${status}, bodyLength=${body.length}`);
    if (!ok) console.log(`[Simkl] Body snippet: ${snippet}`);

    if (status === 403) {
      notify(
        'Simkl 访问异常',
        'HTTP 403',
        '多半是 Cloudflare/站点风控拦截后台请求；请重新用同一网络浏览器捕获 Cookie，或改用官方 API。'
      );
    } else {
      notify(ok ? 'Simkl 访问成功' : 'Simkl 访问异常', `HTTP ${status}`, ok ? `完成时间：${nowISO()}` : '如登录失效，请重新捕获 Cookie。');
    }

    done();
  });
}

if (typeof $request !== 'undefined' && $request && $request.headers) {
  saveCookieFromRequest();
} else {
  runVisit();
}
