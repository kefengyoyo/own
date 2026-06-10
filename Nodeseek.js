// 2026.4.8 | Loon 适配版

/*
@Name：NS论坛签到 (Loon版)
@Author：怎么肥事 (Loon适配)

1️⃣ 使用方法：打开 NodeSeek 点击个人头像进入信息页面，触发抓包获取请求头

──────────────────────────────────────
📌 Loon 配置写法（粘贴到对应节）：
──────────────────────────────────────

[Script]
# 抓取请求头（访问个人信息页时触发）
http-request ^https:\/\/www\.nodeseek\.com\/api\/account\/getInfo\/\d+\?readme=1$ script-path=https://raw.githubusercontent.com/ZenmoFeiShi/Qx/refs/heads/main/Nodeseek_NsCheckin_Loon.js, requires-body=false, tag=NS获取Headers

# 定时签到（每天 00:01 执行）
cron "1 0 * * *" script-path=https://raw.githubusercontent.com/ZenmoFeiShi/Qx/refs/heads/main/Nodeseek_NsCheckin_Loon.js, tag=NS🍗签到, img-url=https://raw.githubusercontent.com/fmz200/wool_scripts/main/icons/author/ZenMoFeiShi.png, enabled=true

[MITM]
hostname = www.nodeseek.com

*/

// ─── 常量 ───────────────────────────────────────────────────────────────────

const NS_HEADER_KEY = "NS_NodeseekHeaders";

// 在 rewrite 脚本中 $request 存在，定时任务中不存在
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

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/**
 * 从请求头对象中提取需要的字段（大小写容错）
 */
function pickNeedHeaders(src = {}) {
  const dst = {};
  const get = (name) =>
    src[name] ?? src[name.toLowerCase()] ?? src[name.toUpperCase()];
  for (const k of NEED_KEYS) {
    const v = get(k);
    if (v !== undefined) dst[k] = v;
  }
  return dst;
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────

if (isGetHeader) {
  // ── 模式1：rewrite 抓头，持久化保存 ────────────────────────────────────────
  const allHeaders = $request.headers || {};
  const picked = pickNeedHeaders(allHeaders);

  if (!picked || Object.keys(picked).length === 0) {
    console.log("[NS] picked headers empty: " + JSON.stringify(allHeaders));
    // Loon 通知 API：$notification.post(title, subtitle, body)
    $notification.post("NS Headers 获取失败", "", "未获取到指定请求头，请重新再试一次。");
    $done({});
  } else {
    // Loon 持久化存储 API：$persistentStore.write(value, key)
    const ok = $persistentStore.write(JSON.stringify(picked), NS_HEADER_KEY);
    console.log("[NS] saved picked headers: " + JSON.stringify(picked));
    if (ok) {
      $notification.post("NS Headers 获取成功", "", "指定请求头已持久化保存。");
    } else {
      $notification.post("NS Headers 保存失败", "", "写入持久化存储失败，请检查配置。");
    }
    $done({});
  }

} else {
  // ── 模式2：定时任务，读取 Headers 后发起签到请求 ───────────────────────────

  // Loon 持久化读取 API：$persistentStore.read(key)
  const raw = $persistentStore.read(NS_HEADER_KEY);

  if (!raw) {
    $notification.post(
      "NS签到结果",
      "无法签到",
      "本地没有已保存的请求头，请先访问一次个人页面进行抓包。"
    );
    $done();
    return;
  }

  let savedHeaders = {};
  try {
    savedHeaders = JSON.parse(raw) || {};
  } catch (e) {
    console.log("[NS] parse saved headers failed: " + e);
    $notification.post(
      "NS签到结果",
      "无法签到",
      "本地保存的请求头数据损坏，请重新访问一次个人页面。"
    );
    $done();
    return;
  }

  const url = "https://www.nodeseek.com/api/attendance?random=true";

  const headers = {
    Connection:        savedHeaders["Connection"]        || "keep-alive",
    "Accept-Encoding": savedHeaders["Accept-Encoding"]  || "gzip, deflate, br",
    Priority:          savedHeaders["Priority"]          || "u=3, i",
    "Content-Type":    savedHeaders["Content-Type"]     || "text/plain;charset=UTF-8",
    Origin:            savedHeaders["Origin"]            || "https://www.nodeseek.com",
    "refract-sign":    savedHeaders["refract-sign"]     || "",
    "User-Agent":      savedHeaders["User-Agent"]       ||
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7.2 Mobile/15E148 Safari/604.1",
    "refract-key":     savedHeaders["refract-key"]      || "",
    "Sec-Fetch-Mode":  savedHeaders["Sec-Fetch-Mode"]   || "cors",
    Cookie:            savedHeaders["Cookie"]            || "",
    Host:              savedHeaders["Host"]              || "www.nodeseek.com",
    Referer:           savedHeaders["Referer"]           || "https://www.nodeseek.com/sw.js?v=0.3.33",
    "Accept-Language": savedHeaders["Accept-Language"]  || "zh-CN,zh-Hans;q=0.9",
    Accept:            savedHeaders["Accept"]            || "*/*",
  };

  // ── Loon HTTP 请求 API：$httpClient.post(options, callback) ─────────────
  // callback 签名：(error, response, data)
  // response.status 为状态码（QX 中为 resp.statusCode）
  // data 为响应体字符串（QX 中为 resp.body）
  $httpClient.post(
    {
      url: url,
      headers: headers,
      body: "",
    },
    (error, response, data) => {
      if (error) {
        const err = String(error || "");
        console.log("[NS签到] request error: " + err);
        $notification.post("NS签到结果", "请求错误", err);
        $done();
        return;
      }

      const status = response.status;   // Loon 用 response.status
      const body   = data || "";

      let msg = "";
      try {
        const obj = JSON.parse(body);
        msg = obj?.message ? String(obj.message) : "";
        console.log("[NS签到] parsed message: " + (msg || "(empty)"));
      } catch (e) {
        console.log("[NS签到] JSON parse failed: " + e);
      }

      if (status === 403) {
        const content = "暂时被风控，稍后再试\n" + (msg ? "内容：" + msg : "响应体：" + body);
        console.log("[NS签到] notify(403): " + content);
        $notification.post("NS签到结果", "403 风控", content);
      } else if (status === 500) {
        const content = msg || body || "服务器错误(500)，无返回内容";
        console.log("[NS签到] notify(500): " + content);
        $notification.post("NS签到结果", "500 服务器错误", content);
      } else if (status >= 200 && status < 300) {
        const content = msg || "NS签到成功，但未返回 message";
        console.log("[NS签到] notify(success): " + content);
        $notification.post("NS签到结果", "签到成功 ✅", content);
      } else {
        const content = msg || body || "请求失败，status=" + status;
        console.log("[NS签到] notify(other): " + content);
        $notification.post("NS签到结果", "请求异常 " + status, content);
      }

      $done();
    }
  );
}
