// 2026.4.8 | Loon 适配版 v2

/*
@Name：NS论坛签到 (Loon版)
@Author：怎么肥事 (Loon适配)

★ 核心改动：签到在 rewrite 上下文（用户访问个人页时）立即执行，
  避免 Loon $httpClient 在 cron 里因 TLS 指纹与浏览器不同被 Cloudflare 拦截。

──────────────────────────────────────────────────────
📌 Loon 配置（粘贴到对应节）：
──────────────────────────────────────────────────────

[Script]
# ① 访问个人信息页时自动签到（主要方式）
http-request ^https:\/\/www\.nodeseek\.com\/api\/account\/getInfo\/\d+\?readme=1$ script-path=本脚本URL, requires-body=false, tag=NS获取Headers并签到

# ② 每天 00:01 兜底重试（应对未访问个人页的日子）
cron "1 0 * * *" script-path=本脚本URL, tag=NS🍗签到兜底, img-url=https://raw.githubusercontent.com/fmz200/wool_scripts/main/icons/author/ZenMoFeiShi.png, enabled=true

[MITM]
hostname = www.nodeseek.com

──────────────────────────────────────────────────────
📋 使用流程：
  1. 配置好 MITM 后，在 NodeSeek 点击头像进入个人信息页
  2. 脚本自动捕获请求头 + 立即发起签到
  3. 之后每天打开个人页即可完成签到；若未打开则 cron 在 00:01 兜底
──────────────────────────────────────────────────────
*/

// ─── 常量 ───────────────────────────────────────────────────────────────────

const NS_HEADER_KEY    = "NS_NodeseekHeaders";
const NS_CHECKIN_DATE  = "NS_LastCheckinDate";

const isGetHeader = typeof $request !== "undefined";

const NEED_KEYS = [
  "Connection", "Accept-Encoding", "Priority", "Content-Type",
  "Origin", "refract-sign", "User-Agent", "refract-key",
  "Sec-Fetch-Mode", "Cookie", "Host", "Referer",
  "Accept-Language", "Accept",
];

// ─── 工具函数 ────────────────────────────────────────────────────────────────

function pickNeedHeaders(src) {
  src = src || {};
  const dst = {};
  const get = (name) =>
    src[name] ?? src[name.toLowerCase()] ?? src[name.toUpperCase()];
  for (const k of NEED_KEYS) {
    const v = get(k);
    if (v !== undefined) dst[k] = v;
  }
  return dst;
}

function getTodayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}

function isCheckedInToday() {
  return $persistentStore.read(NS_CHECKIN_DATE) === getTodayStr();
}

function markCheckedIn() {
  $persistentStore.write(getTodayStr(), NS_CHECKIN_DATE);
}

// ─── 签到核心函数 ─────────────────────────────────────────────────────────────

/**
 * 使用保存的 headers 向 NodeSeek 发起签到请求
 * @param {object}   savedHeaders  已保存的请求头对象
 * @param {function} callback      (result: {success, title, message}) => void
 */
function doCheckIn(savedHeaders, callback) {
  const url = "https://www.nodeseek.com/api/attendance?random=true";

  // 只发送必要头，避免 Loon 与自动管理头产生冲突
  const headers = {
    "Content-Type":    savedHeaders["Content-Type"]    || "text/plain;charset=UTF-8",
    "Origin":          savedHeaders["Origin"]          || "https://www.nodeseek.com",
    "refract-sign":    savedHeaders["refract-sign"]    || "",
    "User-Agent":      savedHeaders["User-Agent"]      ||
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7.2 Mobile/15E148 Safari/604.1",
    "refract-key":     savedHeaders["refract-key"]     || "",
    "Sec-Fetch-Mode":  savedHeaders["Sec-Fetch-Mode"]  || "cors",
    "Cookie":          savedHeaders["Cookie"]          || "",
    "Referer":         savedHeaders["Referer"]         || "https://www.nodeseek.com/sw.js?v=0.3.33",
    "Accept-Language": savedHeaders["Accept-Language"] || "zh-CN,zh-Hans;q=0.9",
    "Accept":          savedHeaders["Accept"]          || "*/*",
    "Priority":        savedHeaders["Priority"]        || "u=3, i",
  };

  console.log("[NS签到] Cookie 前30字符: " + (headers["Cookie"] || "").slice(0, 30));
  console.log("[NS签到] refract-sign 长度: " + (headers["refract-sign"] || "").length);

  $httpClient.post({ url: url, headers: headers, body: "" }, function(error, response, data) {
    if (error) {
      const err = String(error || "");
      console.log("[NS签到] 请求错误: " + err);
      callback({ success: false, title: "请求错误", message: err });
      return;
    }

    const status = response.status;
    const body   = data || "";

    console.log("[NS签到] HTTP 状态码: " + status);

    // Cloudflare 拦截检测
    if (body.indexOf("Just a moment") !== -1 || body.indexOf("challenges.cloudflare") !== -1) {
      console.log("[NS签到] 遭遇 Cloudflare 拦截，Cookie 可能已过期，请重新访问个人页面");
      callback({
        success: false,
        title: "Cloudflare 拦截",
        message: "Cookie 与当前网络环境不匹配，请在 NodeSeek 重新访问个人页面刷新 Cookie。"
      });
      return;
    }

    let msg = "";
    try {
      const obj = JSON.parse(body);
      msg = obj && obj.message ? String(obj.message) : "";
      console.log("[NS签到] 返回 message: " + (msg || "(空)"));
    } catch (e) {
      console.log("[NS签到] JSON 解析失败: " + e);
    }

    if (status === 403) {
      const content = "暂时被风控，稍后再试" + (msg ? "\n内容：" + msg : "\n响应：" + body.slice(0, 100));
      callback({ success: false, title: "403 风控", message: content });
    } else if (status === 500) {
      callback({ success: false, title: "500 服务器错误", message: msg || body.slice(0, 100) || "服务器内部错误" });
    } else if (status >= 200 && status < 300) {
      markCheckedIn();
      callback({ success: true, title: "签到成功 ✅", message: msg || "签到成功，未返回具体信息" });
    } else {
      callback({ success: false, title: "请求异常 " + status, message: msg || body.slice(0, 100) || "status=" + status });
    }
  });
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────

if (isGetHeader) {
  // ══ 模式1：rewrite 拦截（主要签到入口）══════════════════════════════════════
  // 在用户主动浏览 NodeSeek 时触发，此上下文与浏览器同会话，
  // Cloudflare TLS 指纹检测通过率更高

  const allHeaders = $request.headers || {};
  const picked = pickNeedHeaders(allHeaders);

  if (!picked || Object.keys(picked).length === 0) {
    console.log("[NS] 未捕获到有效请求头: " + JSON.stringify(allHeaders));
    $notification.post("NS Headers 获取失败", "", "未获取到指定请求头，请重新访问个人页面。");
    $done({});
    return;
  }

  // 持久化保存请求头
  const saved = $persistentStore.write(JSON.stringify(picked), NS_HEADER_KEY);
  console.log("[NS] 请求头已保存，成功=" + saved);

  // 今天已签到则只更新 Headers，不重复签到
  if (isCheckedInToday()) {
    $notification.post("NS Headers 已更新", "今日已签到 ✅", "无需重复签到。");
    $done({});
    return;
  }

  // 立即在 rewrite 上下文内签到（核心：避免 Cloudflare TLS 指纹问题）
  doCheckIn(picked, function(result) {
    $notification.post("NS签到结果", result.title, result.message);
    $done({});
  });

} else {
  // ══ 模式2：cron 兜底任务 ═══════════════════════════════════════════════════
  // 若当天已经通过 rewrite 签到，则直接跳过

  if (isCheckedInToday()) {
    $notification.post("NS签到", "今日已签到 ✅", "已通过访问个人页完成，无需兜底。");
    $done();
    return;
  }

  const raw = $persistentStore.read(NS_HEADER_KEY);
  if (!raw) {
    $notification.post("NS签到结果", "无法签到", "本地没有已保存的请求头，请先访问个人页面一次。");
    $done();
    return;
  }

  let savedHeaders = {};
  try {
    savedHeaders = JSON.parse(raw) || {};
  } catch (e) {
    $notification.post("NS签到结果", "数据损坏", "请求头数据损坏，请重新访问个人页面。");
    $done();
    return;
  }

  doCheckIn(savedHeaders, function(result) {
    $notification.post("NS签到结果", result.title, result.message);
    $done();
  });
}
