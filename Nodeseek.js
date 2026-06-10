// 2026.06.10
// NS 论坛签到 - Loon 兼容版
// 原脚本：https://raw.githubusercontent.com/ZenmoFeiShi/Qx/refs/heads/main/Nodeseek_NsCheckin.js

/*
#!name=NS论坛签到
#!desc=NodeSeek 签到；先访问个人信息页获取请求头，再由定时任务签到。
#!author=怎么肥事 / Loon adapted by Minis

[Script]
# 1. 获取请求头：登录 NodeSeek 后，点击头像进入个人信息页触发
http-request ^https:\/\/www\.nodeseek\.com\/api\/account\/getInfo\/\d+\?readme=1$ script-path=https://raw.githubusercontent.com/ZenmoFeiShi/Qx/refs/heads/main/Nodeseek_NsCheckin_Loon.js, requires-body=false, timeout=30, tag=NS🍗获取Headers

# 2. 每天 00:01 签到
cron "1 0 * * *" script-path=https://raw.githubusercontent.com/ZenmoFeiShi/Qx/refs/heads/main/Nodeseek_NsCheckin_Loon.js, timeout=60, tag=NS🍗签到

[MITM]
hostname = www.nodeseek.com
*/

const NS_HEADER_KEY = "NS_NodeseekHeaders";
const isGetHeader = typeof $request !== "undefined";

const NEED_KEYS = [
  "Connection",
  "Accept-Encoding",
  "Priority",
  "Content-Type",
  "Origin",
  "refract-sign",
  "User-Agent",
  "refract-key",
  "Sec-Fetch-Mode",
  "Cookie",
  "Host",
  "Referer",
  "Accept-Language",
  "Accept",
];

function log(msg) {
  console.log(`[NS] ${msg}`);
}

function notify(title, subtitle, body) {
  if (typeof $notification !== "undefined" && $notification.post) {
    $notification.post(title, subtitle || "", body || "");
  } else if (typeof $notify !== "undefined") {
    $notify(title, subtitle || "", body || "");
  } else {
    console.log(`${title} ${subtitle || ""} ${body || ""}`);
  }
}

const store = {
  read(key) {
    if (typeof $persistentStore !== "undefined" && $persistentStore.read) {
      return $persistentStore.read(key);
    }
    if (typeof $prefs !== "undefined" && $prefs.valueForKey) {
      return $prefs.valueForKey(key);
    }
    return null;
  },
  write(value, key) {
    if (typeof $persistentStore !== "undefined" && $persistentStore.write) {
      return $persistentStore.write(value, key);
    }
    if (typeof $prefs !== "undefined" && $prefs.setValueForKey) {
      return $prefs.setValueForKey(value, key);
    }
    return false;
  },
};

function httpFetch(options, callback) {
  if (typeof $httpClient !== "undefined") {
    const method = String(options.method || "GET").toUpperCase();
    if (method === "POST") return $httpClient.post(options, callback);
    if (method === "PUT") return $httpClient.put(options, callback);
    if (method === "DELETE") return $httpClient.delete(options, callback);
    return $httpClient.get(options, callback);
  }

  if (typeof $task !== "undefined" && $task.fetch) {
    return $task.fetch(options).then(
      (resp) => callback(null, resp, resp.body || ""),
      (err) => callback(err, null, "")
    );
  }

  callback(new Error("当前运行环境不支持 $httpClient 或 $task.fetch"), null, "");
}

function pickNeedHeaders(src = {}) {
  const dst = {};
  const get = (name) =>
    src[name] ??
    src[name.toLowerCase()] ??
    src[name.toUpperCase()];

  for (const k of NEED_KEYS) {
    const v = get(k);
    if (v !== undefined && v !== null && String(v) !== "") dst[k] = String(v);
  }
  return dst;
}

function finish(value) {
  if (typeof $done !== "undefined") $done(value || {});
}

function saveHeaders() {
  const allHeaders = ($request && $request.headers) || {};
  const picked = pickNeedHeaders(allHeaders);

  if (!picked || Object.keys(picked).length === 0) {
    log(`picked headers empty: ${JSON.stringify(allHeaders)}`);
    notify("NS Headers 获取失败", "", "未获取到指定请求头，请重新再试一次。");
    return finish({});
  }

  const ok = store.write(JSON.stringify(picked), NS_HEADER_KEY);
  const keys = Object.keys(picked).join(", ");
  log(`saved picked header keys: ${keys}`);
  if (ok) {
    notify("NS Headers 获取成功", "", `已保存：${keys}`);
  } else {
    notify("NS Headers 保存失败", "", "写入持久化存储失败，请检查 Loon 配置。");
  }
  return finish({});
}

function safeBodyPreview(body) {
  return String(body || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function doCheckin() {
  const raw = store.read(NS_HEADER_KEY);
  if (!raw) {
    notify("NS签到结果", "无法签到", "本地没有已保存的请求头，请先抓包访问一次个人页面。");
    return finish();
  }

  let savedHeaders = {};
  try {
    savedHeaders = JSON.parse(raw) || {};
  } catch (e) {
    log(`parse saved headers failed: ${e}`);
    notify("NS签到结果", "无法签到", "本地保存的请求头数据损坏，请重新访问一次个人页面。");
    return finish();
  }

  const headers = {
    "Accept": savedHeaders["Accept"] || "*/*",
    "Accept-Encoding": savedHeaders["Accept-Encoding"] || "gzip, deflate, br",
    "Accept-Language": savedHeaders["Accept-Language"] || "zh-CN,zh-Hans;q=0.9",
    "Connection": savedHeaders["Connection"] || "keep-alive",
    "Content-Type": savedHeaders["Content-Type"] || "text/plain;charset=UTF-8",
    "Cookie": savedHeaders["Cookie"] || "",
    "Host": savedHeaders["Host"] || "www.nodeseek.com",
    "Origin": savedHeaders["Origin"] || "https://www.nodeseek.com",
    "Priority": savedHeaders["Priority"] || "u=3, i",
    "Referer": savedHeaders["Referer"] || "https://www.nodeseek.com/sw.js?v=0.3.33",
    "Sec-Fetch-Mode": savedHeaders["Sec-Fetch-Mode"] || "cors",
    "User-Agent": savedHeaders["User-Agent"] || "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7.2 Mobile/15E148 Safari/604.1",
    "refract-key": savedHeaders["refract-key"] || "",
    "refract-sign": savedHeaders["refract-sign"] || "",
  };

  const options = {
    url: "https://www.nodeseek.com/api/attendance?random=true",
    method: "POST",
    headers,
    body: "",
  };

  httpFetch(options, (error, response, data) => {
    if (error) {
      const err = error && error.error ? String(error.error) : String(error || "");
      log(`request error: ${err}`);
      notify("NS签到结果", "请求错误", err);
      return finish();
    }

    const status = Number(response && (response.status || response.statusCode)) || 0;
    const body = data || (response && response.body) || "";
    let msg = "";

    try {
      const obj = JSON.parse(body);
      msg = obj && obj.message ? String(obj.message) : "";
      log(`parsed message: ${msg || "(empty)"}`);
    } catch (e) {
      const preview = safeBodyPreview(body) || String(body || "").slice(0, 300);
      log(`non-json response, status=${status}, preview=${preview}`);
      msg = preview;
    }

    if (status === 403) {
      notify("NS签到结果", "403 风控", `暂时被风控，稍后再试\n${msg ? `内容：${msg}` : `响应体：${body}`}`);
    } else if (status === 401 || status === 302) {
      notify("NS签到结果", `${status} 登录失效`, msg || "返回登录/跳转页面，请重新获取 Headers。");
    } else if (status === 500) {
      notify("NS签到结果", "500 服务器错误", msg || body || "服务器错误(500)，无返回内容");
    } else if (status >= 200 && status < 300) {
      const looksLikeHtml = /^\s*</.test(String(body || ""));
      if (looksLikeHtml) {
        notify("NS签到结果", "返回HTML，疑似未登录/风控", msg || "请重新获取 Headers 后再试。");
      } else {
        notify("NS签到结果", "签到成功", msg || "NS签到成功，但未返回 message");
      }
    } else {
      notify("NS签到结果", `请求异常 ${status}`, msg || body || `请求失败，status=${status}`);
    }

    return finish();
  });
}

if (isGetHeader) {
  saveHeaders();
} else {
  doCheckin();
}
