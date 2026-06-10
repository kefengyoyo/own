// NS 论坛签到 - Loon 兼容增强版 v3
// 重点：可抓取真实 /api/attendance?random=true 手动签到请求 Headers；不输出 Cookie 内容。

/*
#!name=NS论坛签到 Loon v3
#!desc=先手动签到一次抓取真实签到 Headers，再定时重放。版本：2026.06.10-v3

[Script]
# 登录 NodeSeek 后，进入个人页可抓基础 Headers
http-request ^https:\/\/www\.nodeseek\.com\/api\/account\/getInfo\/\d+\?readme=1$ script-path=https://你的脚本地址/Nodeseek_NsCheckin_Loon_v3.js, requires-body=false, timeout=30, tag=NS🍗获取基础Headers-v3

# 更推荐：手动点一次签到，抓取真实签到接口 Headers
http-request ^https:\/\/www\.nodeseek\.com\/api\/attendance\?random=true$ script-path=https://你的脚本地址/Nodeseek_NsCheckin_Loon_v3.js, requires-body=false, timeout=30, tag=NS🍗获取签到Headers-v3

# 定时签到
cron "1 0 * * *" script-path=https://你的脚本地址/Nodeseek_NsCheckin_Loon_v3.js, timeout=60, tag=NS🍗签到-v3

[MITM]
hostname = %APPEND% www.nodeseek.com
*/

const VERSION = "2026.06.10-v3";
const STORE_KEY = "NS_NodeseekHeaders_v3";
const isRequest = typeof $request !== "undefined";
console.log(`[NS] Loon script loaded, version=${VERSION}`);

function notify(title, subtitle, body) {
  if (typeof $notification !== "undefined" && $notification.post) $notification.post(title, subtitle || "", body || "");
  else if (typeof $notify !== "undefined") $notify(title, subtitle || "", body || "");
  else console.log(`${title} ${subtitle || ""} ${body || ""}`);
}

const store = {
  read(key) {
    if (typeof $persistentStore !== "undefined" && $persistentStore.read) return $persistentStore.read(key);
    if (typeof $prefs !== "undefined" && $prefs.valueForKey) return $prefs.valueForKey(key);
    return null;
  },
  write(value, key) {
    if (typeof $persistentStore !== "undefined" && $persistentStore.write) return $persistentStore.write(value, key);
    if (typeof $prefs !== "undefined" && $prefs.setValueForKey) return $prefs.setValueForKey(value, key);
    return false;
  },
};

function done(v) { if (typeof $done !== "undefined") $done(v || {}); }

function getHeader(headers, name) {
  if (!headers) return "";
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || "";
}

function normalizeHeaders(src) {
  const out = {};
  Object.keys(src || {}).forEach((k) => {
    const v = src[k];
    if (v === undefined || v === null || String(v) === "") return;
    const lk = k.toLowerCase();
    if (["content-length"].includes(lk)) return;
    if (lk.startsWith(":")) return;
    out[k] = String(v);
  });

  // 兜底补齐，尽量保留浏览器特征
  if (!getHeader(out, "Host")) out["Host"] = "www.nodeseek.com";
  if (!getHeader(out, "Origin")) out["Origin"] = "https://www.nodeseek.com";
  if (!getHeader(out, "Referer")) out["Referer"] = "https://www.nodeseek.com/";
  if (!getHeader(out, "Accept")) out["Accept"] = "*/*";
  if (!getHeader(out, "Content-Type")) out["Content-Type"] = "text/plain;charset=UTF-8";
  return out;
}

function hasCfClearance(headers) {
  return /(?:^|;\s*)cf_clearance=/.test(getHeader(headers, "Cookie"));
}

function headerKeysForLog(headers) {
  return Object.keys(headers || {}).filter((k) => k.toLowerCase() !== "cookie").join(", ");
}

function requestType(url) {
  if (/\/api\/attendance\?random=true/.test(url || "")) return "attendance";
  if (/\/api\/account\/getInfo\/\d+\?readme=1/.test(url || "")) return "getInfo";
  return "unknown";
}

function saveCurrentHeaders() {
  const url = ($request && $request.url) || "";
  const type = requestType(url);
  const headers = normalizeHeaders(($request && $request.headers) || {});
  const payload = { version: VERSION, type, url, savedAt: new Date().toISOString(), headers };
  const ok = store.write(JSON.stringify(payload), STORE_KEY);
  const cf = hasCfClearance(headers) ? "是" : "否";
  const keys = headerKeysForLog(headers);
  console.log(`[NS] saved ${type} headers, cf_clearance=${cf}, keys=${keys}`);
  notify(ok ? "NS Headers 获取成功" : "NS Headers 保存失败", `类型：${type}，cf_clearance：${cf}`, ok ? `已保存字段：${keys}` : "写入持久化存储失败");
  done({});
}

function httpPost(options, cb) {
  if (typeof $httpClient !== "undefined") return $httpClient.post(options, cb);
  if (typeof $task !== "undefined" && $task.fetch) {
    return $task.fetch(options).then((r) => cb(null, r, r.body || ""), (e) => cb(e, null, ""));
  }
  cb(new Error("no http client"), null, "");
}

function bodyPreview(body) {
  return String(body || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function checkin() {
  const raw = store.read(STORE_KEY);
  if (!raw) {
    notify("NS签到结果", "无法签到", "没有保存 Headers。请先手动点一次签到，抓取真实签到 Headers。");
    return done();
  }

  let saved;
  try { saved = JSON.parse(raw); } catch (e) {
    notify("NS签到结果", "无法签到", "Headers 数据损坏，请重新抓取。");
    return done();
  }

  const headers = normalizeHeaders(saved.headers || {});
  console.log(`[NS] use saved type=${saved.type}, savedAt=${saved.savedAt}, cf_clearance=${hasCfClearance(headers) ? "yes" : "no"}`);

  if (saved.type !== "attendance") {
    console.log("[NS] warning: saved headers are not from attendance API; recommend manual checkin capture once.");
  }

  const options = {
    url: "https://www.nodeseek.com/api/attendance?random=true",
    method: "POST",
    headers,
    body: "",
  };

  httpPost(options, (error, response, data) => {
    if (error) {
      const err = error && error.error ? String(error.error) : String(error || "");
      notify("NS签到结果", "请求错误", err);
      return done();
    }

    const status = Number(response && (response.status || response.statusCode)) || 0;
    const body = data || (response && response.body) || "";
    let message = "";
    let isJson = false;
    try {
      const obj = JSON.parse(body);
      isJson = true;
      message = obj && obj.message ? String(obj.message) : JSON.stringify(obj).slice(0, 300);
      console.log(`[NS] json response, status=${status}, message=${message}`);
    } catch (e) {
      message = bodyPreview(body) || String(body).slice(0, 300);
      console.log(`[NS] non-json response, status=${status}, preview=${message}`);
    }

    if (!isJson && /Just a moment|Enable JavaScript and cookies|Cloudflare/i.test(message)) {
      notify("NS签到结果", "Cloudflare 403", "有 cf_clearance 仍被拦截，通常是 Loon 后台请求 TLS/浏览器指纹不被接受。可尝试重新手动签到抓取 attendance Headers。");
    } else if (status >= 200 && status < 300) {
      notify("NS签到结果", "签到成功", message || "成功，但无返回内容");
    } else if (status === 403) {
      notify("NS签到结果", "403", message || "被拒绝，请重新抓取真实签到 Headers。");
    } else {
      notify("NS签到结果", `请求异常 ${status}`, message || `status=${status}`);
    }
    done();
  });
}

if (isRequest) saveCurrentHeaders();
else checkin();
