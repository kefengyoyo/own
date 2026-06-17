// NodeSeek 每日签到 - Loon 专用版
// 功能：Cookie 自动抓取 + 每日签到 + Cookie 过期提醒

const STORE_COOKIE = "NS_Cookie";
const STORE_EXPIRY = "NS_CookieExpiry";
const isCapture    = typeof $request !== "undefined";

// ─── 工具 ─────────────────────────────────────────────────────────────────────

function log(msg)  { console.log("[NS签到] " + msg); }

function notify(title, sub, body) {
  $notification.post(title, sub || "", body || "");
}

function formatDate(d) {
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0") + " " +
    String(d.getHours()).padStart(2, "0") + ":" +
    String(d.getMinutes()).padStart(2, "0");
}

// 从 pjwt JWT 解析过期时间
function parseJwtExpiry(cookie) {
  try {
    const m = cookie.match(/pjwt=([\w-]+)\.([\w-]+)\.([\w-]+)/);
    if (!m) return null;
    const b64 = m[2].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
    const payload = JSON.parse(atob(padded));
    return payload.exp ? new Date(payload.exp * 1000) : null;
  } catch (e) {
    log("JWT 解析失败: " + e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 模式 1：http-request rewrite — Cookie 抓取
// （当用户开启 enableCapture 开关并访问个人中心时触发）
// ═══════════════════════════════════════════════════════════════════════════════

if (isCapture) {
  const headers = $request.headers || {};
  const cookie  = headers["Cookie"] || headers["cookie"] || "";

  if (!cookie || !cookie.includes("pjwt=")) {
    notify("NS Cookie ❌", "获取失败", "未找到有效 Cookie，请确认已登录 NodeSeek。");
    log("未找到有效 Cookie");
    $done({});
    return;
  }

  $persistentStore.write(cookie, STORE_COOKIE);
  log("Cookie 已保存: " + cookie.slice(0, 30) + "...");

  const expiry = parseJwtExpiry(cookie);
  if (expiry) {
    $persistentStore.write(String(expiry.getTime()), STORE_EXPIRY);
    log("Session 过期时间: " + formatDate(expiry));
    notify(
      "NS Cookie ✅ 获取成功",
      "请关闭抓取开关",
      "Session 过期时间：" + formatDate(expiry)
    );
  } else {
    notify("NS Cookie ✅ 获取成功", "请关闭抓取开关", "Cookie 已保存（未能解析过期时间）");
  }

  $done({});
  return;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 模式 2：cron 定时签到
// $argument.nsCookie    手动填写的 Cookie（优先级高于自动抓取）
// $argument.randomReward 随机奖励模式开关
// ═══════════════════════════════════════════════════════════════════════════════

// 读取 Cookie：优先用手动填写，其次用持久化存储
const argCookie = (
  $argument &&
  typeof $argument.nsCookie === "string" &&
  $argument.nsCookie.trim().length > 10
) ? $argument.nsCookie.trim() : null;

const storedCookie = $persistentStore.read(STORE_COOKIE) || "";
const cookie = argCookie || storedCookie;

if (!cookie || !cookie.includes("pjwt=")) {
  notify("NS签到 ❌", "Cookie 不存在", "请先开启抓取开关并访问 NodeSeek 个人中心获取 Cookie。");
  log("Cookie 不存在，退出");
  $done();
  return;
}

// Cookie 过期提醒（剩余 48 小时内提醒）
const expiryStr = $persistentStore.read(STORE_EXPIRY);
if (expiryStr) {
  const expiryMs  = parseInt(expiryStr, 10);
  const remainMs  = expiryMs - Date.now();
  if (remainMs <= 0) {
    notify("NS Cookie ❌ 已过期", "请重新登录", "请开启抓取开关重新访问个人中心获取 Cookie。");
    log("Cookie 已过期");
    $done();
    return;
  }
  if (remainMs < 48 * 3600 * 1000) {
    const hrs = Math.floor(remainMs / 3600000);
    notify(
      "NS Cookie ⚠️ 即将过期",
      "约 " + hrs + " 小时后过期",
      "请尽快开启抓取开关，访问个人中心重新获取 Cookie。"
    );
    log("Cookie 即将过期，剩余 " + hrs + " 小时");
  }
}

// 发起签到请求
const randomReward = $argument && (
  $argument.randomReward === true || $argument.randomReward === "true"
);
const url = "https://www.nodeseek.com/api/attendance?random=" + randomReward;

log("开始签到，random=" + randomReward);
log("Cookie 前30字符: " + cookie.slice(0, 30));

$httpClient.post({
  url: url,
  headers: {
    "Cookie":          cookie,
    "Content-Type":    "text/plain;charset=UTF-8",
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Origin":          "https://www.nodeseek.com",
    "Referer":         "https://www.nodeseek.com/",
    "Accept":          "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9"
  },
  body: ""
}, function(error, response, data) {

  if (error) {
    log("请求错误: " + error);
    notify("NS签到 ❌", "请求失败", String(error));
    $done();
    return;
  }

  const status = response.status || response.statusCode || 0;
  const body   = data || "";
  log("HTTP 状态: " + status);

  // Cloudflare 拦截检测
  if (body.indexOf("Just a moment") !== -1 || body.indexOf("challenges.cloudflare") !== -1) {
    notify(
      "NS签到 ❌", "Cloudflare 拦截",
      "请访问 NodeSeek 任意页面后重新开启抓取开关刷新 Cookie。"
    );
    log("遭遇 Cloudflare 拦截");
    $done();
    return;
  }

  let msg = "";
  try {
    msg = (JSON.parse(body) || {}).message || "";
  } catch (e) {}

  if (status >= 200 && status < 300) {
    log("签到成功: " + msg);
    notify("NS签到 ✅", "签到成功", msg || "签到成功");
  } else if (status === 403) {
    log("签到失败 403: " + msg);
    notify("NS签到 ❌", "403 风控", msg || "请稍后重试或重新抓取 Cookie");
  } else if (status === 500) {
    log("签到失败 500");
    notify("NS签到 ❌", "服务器错误 500", msg || "NodeSeek 服务器内部错误");
  } else {
    log("签到异常 " + status + ": " + msg);
    notify("NS签到 ❌", "异常 HTTP " + status, msg || body.slice(0, 100));
  }

  $done();
});
