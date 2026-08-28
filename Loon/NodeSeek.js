/******************************
 * NodeSeek Loon Script
 * Egern NodeSeek v1.1.2 -> Loon Script v2
 ******************************/

const SCRIPT_NAME = "NodeSeek🎉";
const STORE_KEY = "nodeseek_headers";
const ATTEND_BASE = "https://www.nodeseek.com/api/attendance";

const DEFAULT_HEADERS = {
  Connection: "keep-alive",
  "Accept-Encoding": "gzip, deflate, br",
  Priority: "u=3, i",
  "Content-Type": "text/plain;charset=UTF-8",
  Origin: "https://www.nodeseek.com",
  "refract-sign": "",
  "User-Agent": "Mozilla/5.0",
  "refract-key": "",
  "Sec-Fetch-Mode": "cors",
  Cookie: "",
  Host: "www.nodeseek.com",
  Referer: "https://www.nodeseek.com/",
  "Accept-Language": "zh-CN,zh-Hans;q=0.9",
  Accept: "*/*"
};

const HEADER_KEYS = Object.keys(DEFAULT_HEADERS);

function log(msg) {
  console.log("[" + SCRIPT_NAME + "] " + msg);
}

function notify(subtitle, body) {
  log(subtitle + ": " + body);
  if (typeof $notification !== "undefined" && $notification.post) {
    $notification.post(SCRIPT_NAME, subtitle, body);
  }
}

function argObject() {
  if ($argument && typeof $argument === "object") return $argument;
  return {};
}

function trueValue(value) {
  if (value === true || value === 1 || value === "1") return true;
  if (typeof value === "string") {
    return ["true", "yes", "on"].indexOf(value.trim().toLowerCase()) !== -1;
  }
  return false;
}

function headerValue(src, key) {
  return src[key] || src[key.toLowerCase()] || src[key.toUpperCase()] || "";
}

function pickHeaders(src) {
  const saved = {};
  for (let i = 0; i < HEADER_KEYS.length; i++) {
    const key = HEADER_KEYS[i];
    const value = headerValue(src || {}, key);
    if (value) saved[key] = value;
  }
  return saved;
}

function buildAttendHeaders(saved) {
  const headers = {};
  for (let i = 0; i < HEADER_KEYS.length; i++) {
    const key = HEADER_KEYS[i];
    headers[key] = (saved && saved[key]) || DEFAULT_HEADERS[key];
  }
  return headers;
}

function finish() {
  if (typeof $done === "function") $done();
}

function captureHeaders() {
  if (!trueValue(argObject().ENABLE_CAPTURE)) {
    log("Cookie 开关已关闭，跳过");
    finish();
    return;
  }

  const saved = pickHeaders(($request && $request.headers) || {});

  if (Object.keys(saved).length === 0) {
    notify("Cookie 失败", "未获取到 NodeSeek 请求头");
    finish();
    return;
  }

  const ok = $persistentStore.write(JSON.stringify(saved), STORE_KEY);

  if (!ok) {
    notify("保存失败", "无法保存 NodeSeek 请求头");
    finish();
    return;
  }

  log("请求头已保存，共 " + Object.keys(saved).length + " 个字段");
  notify("Cookie 成功", "请求头已保存，请关闭 Cookie 捕获");
  finish();
}

function checkIn() {
  const fixed = trueValue(argObject().FIXED_LEGS);
  const url = ATTEND_BASE + "?random=" + (fixed ? "false" : "true");

  log("开始执行签到任务（" + (fixed ? "固定鸡腿" : "随机鸡腿") + "）");

  const raw = $persistentStore.read(STORE_KEY);

  if (!raw) {
    notify("缺少请求头", "请先打开 Cookie 捕获并访问 NodeSeek 个人页面");
    finish();
    return;
  }

  let saved;
  try {
    saved = JSON.parse(raw);
  } catch (e) {
    notify("数据异常", "请重新打开 Cookie 捕获并访问个人页面");
    finish();
    return;
  }

  $httpClient.post({
    url: url,
    headers: buildAttendHeaders(saved),
    body: "",
    timeout: 10000
  }, function(error, response, data) {

    if (error) {
      notify("网络错误", "请检查网络连接");
      log(error && error.message ? error.message : String(error));
      finish();
      return;
    }

    const status = response ? response.status : 0;
    let message = "";

    try {
      message = (JSON.parse(data) || {}).message || "";
    } catch (e) {}

    const modeTag = fixed ? "固定" : "随机";

    if (status === 403) {
      notify("被风控", "403，稍后重试");
    } else if (status === 500) {
      notify("服务器错误", "500");
    } else if (status >= 200 && status < 300) {
      notify("签到成功（" + modeTag + "）", message || "签到完成");
    } else {
      notify("请求异常", "HTTP " + status + (message ? "：" + message : ""));
    }

    finish();
  });
}

function main() {
  /*
   * Response Script 使用 ENABLE_CAPTURE；
   * Cron Script 使用 FIXED_LEGS。
   * Loon 插件对象参数会按配置传入对应字段。
   */
  const arg = argObject();

  if (typeof $response !== "undefined") {
    captureHeaders();
    return;
  }

  if (typeof $request === "undefined" || !$request) {
    checkIn();
    return;
  }

  checkIn();
}

main();
