const CFG = {
  cookieKey: "simkl_cookie",
  profileKey: "simkl_header_profile",
  lastRunKey: "simkl_last_run",
  visitUrl: "https://simkl.com/",
  timeout: 15000,
  fallbackUA:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1"
};

function done(v) {
  try { $done(v || {}); } catch (_) { try { $done(); } catch (__) {} }
}

function notify(title, sub, body) {
  try { $notification.post(title, sub || "", body || ""); } catch (_) {}
}

function getHeader(headers, name) {
  if (!headers) return "";
  if (headers[name] !== undefined) return headers[name];

  const target = name.toLowerCase();
  const keys = Object.keys(headers);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === target) return headers[keys[i]];
  }
  return "";
}

function isSimklUrl(url) {
  return /^https:\/\/simkl\.com(?:\/|$)/i.test(url || "");
}

function isUsefulCookie(cookie) {
  if (!cookie) return false;

  // 至少应该是 cookie=value 形式。
  // 不强制要求 cf_clearance，因为正常登录会话不一定每次都有它。
  return /(^|;\s*)[^=\s;]+=[^;]*/.test(cookie);
}

function saveCookieFromBrowser() {
  const req = $request || {};
  const url = req.url || "";

  if (!isSimklUrl(url)) {
    return done({});
  }

  // 只捕获浏览器 GET 请求，避免登录跳转/POST 等上下文污染。
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET") {
    return done({});
  }

  const headers = req.headers || {};
  const cookie = getHeader(headers, "Cookie");

  console.log("[Simkl] Capture request: " + url);
  console.log("[Simkl] method=" + method);
  console.log("[Simkl] cookiePresent=" + (!!cookie));

  /*
   * 关键修复：
   * 如果本次请求没有 Cookie，不再覆盖旧 Cookie。
   * Cloudflare challenge、静态资源、首次访问等请求可能没有 Cookie。
   */
  if (!isUsefulCookie(cookie)) {
    console.log("[Simkl] No usable Cookie; keep existing stored Cookie.");
    return done({});
  }

  const profile = {
    "User-Agent": getHeader(headers, "User-Agent") || CFG.fallbackUA,
    "Accept":
      getHeader(headers, "Accept") ||
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language":
      getHeader(headers, "Accept-Language") ||
      "zh-CN,zh-Hans;q=0.9,en;q=0.8"
  };

  const oldCookie = $persistentStore.read(CFG.cookieKey) || "";

  $persistentStore.write(cookie, CFG.cookieKey);
  $persistentStore.write(JSON.stringify(profile), CFG.profileKey);

  const hasCF = /(?:^|;\s*)cf_clearance=/i.test(cookie);
  const changed = cookie !== oldCookie;

  console.log(
    "[Simkl] Cookie " +
      (changed ? "saved" : "unchanged") +
      "; length=" +
      cookie.length +
      "; has_cf_clearance=" +
      hasCF +
      "; ua=" +
      profile["User-Agent"]
  );

  notify(
    changed ? "Simkl Cookie 已更新" : "Simkl Cookie 已刷新",
    hasCF ? "Cookie + cf_clearance 已保存" : "Cookie 已保存",
    hasCF
      ? "浏览器会话捕获成功。"
      : "已保存登录 Cookie；未发现 cf_clearance。"
  );

  done({});
}

function runVisit() {
  const cookie = $persistentStore.read(CFG.cookieKey) || "";

  if (!cookie) {
    notify(
      "Simkl 定时访问",
      "没有保存的 Cookie",
      "请先用 Safari 打开 simkl.com，让 Loon 捕获登录会话。"
    );
    return done({});
  }

  let profile = {};
  try {
    profile = JSON.parse(
      $persistentStore.read(CFG.profileKey) || "{}"
    );
  } catch (_) {
    profile = {};
  }

  const headers = Object.assign(
    {
      "User-Agent": CFG.fallbackUA,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh-Hans;q=0.9,en;q=0.8"
    },
    profile,
    {
      Cookie: cookie,
      "Cache-Control": "no-cache",
      Pragma: "no-cache"
    }
  );

  console.log(
    "[Simkl] Visiting " +
      CFG.visitUrl +
      "; ua=" +
      headers["User-Agent"] +
      "; has_cf_clearance=" +
      /(?:^|;\s*)cf_clearance=/i.test(cookie)
  );

  $httpClient.get(
    {
      url: CFG.visitUrl,
      timeout: CFG.timeout,
      headers: headers,
      // Build 662+：允许 Loon HTTP Client 自动维护 Set-Cookie。
      "auto-cookie": true,
      // 使用 h1，避免部分站点边缘设备对后台 h2 指纹的差异。
      alpn: "h1"
    },
    function (error, response, data) {
      if (error) {
        console.log("[Simkl] Request error: " + JSON.stringify(error));
        notify("Simkl 定时访问失败", "网络请求错误", String(error));
        return done({});
      }

      const status = response && response.status ? response.status : 0;
      const body = data ? String(data) : "";

      $persistentStore.write(
        new Date().toISOString(),
        CFG.lastRunKey
      );

      console.log(
        "[Simkl] Visit finished. status=" +
          status +
          ", bodyLength=" +
          body.length
      );

      if (status === 403) {
        const cfPage =
          /Just a moment|cf-chl-|Cloudflare/i.test(body);

        console.log(
          "[Simkl] 403 detected; Cloudflare challenge=" + cfPage
        );

        /*
         * 不再把这个 403 当成 Cookie 获取失败。
         * Cookie 已经由浏览器请求独立保存。
         */
        notify(
          "Simkl 后台访问被拦截",
          "HTTP 403",
          cfPage
            ? "Cookie 已保存；Simkl 首页的 Cloudflare 验证拒绝了 Loon 后台请求。"
            : "Cookie 已保存，但 Simkl 拒绝了后台请求。"
        );

        return done({});
      }

      if (status >= 200 && status < 400) {
        notify(
          "Simkl 定时访问成功",
          "HTTP " + status,
          "Cookie 会话仍可正常访问。"
        );
      } else {
        notify(
          "Simkl 定时访问异常",
          "HTTP " + status,
          "Cookie 捕获功能不受此次后台访问状态影响。"
        );
      }

      done({});
    }
  );
}

/*
 * Request Script：
 * 捕获浏览器发往 simkl.com 的真实 Cookie。
 *
 * Cron：
 * 没有 $request 时执行后台访问。
 */
if (
  typeof $request !== "undefined" &&
  $request &&
  $request.headers
) {
  saveCookieFromBrowser();
} else {
  runVisit();
}
