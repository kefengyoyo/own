// 2026.4.8 | Loon 适配版 v3

/*
@Name：NS论坛签到 (Loon版)
@Author：怎么肥事 (Loon适配)

★ 核心原理：
  Loon $httpClient 的 TLS 指纹与浏览器不同，直接被 Cloudflare 拦截（403）。
  本版改为向 NodeSeek HTML 页面注入 <script>，由浏览器 fetch() 发起签到请求。
  浏览器的 TLS 指纹与 cf_clearance 完全匹配，Cloudflare 无法拦截。

──────────────────────────────────────────────────────────────────
📌 Loon 配置（粘贴到对应节）：
──────────────────────────────────────────────────────────────────

[Script]
# ① 捕获请求头（用于取得 refract-sign / refract-key，访问个人页时触发）
http-request ^https:\/\/www\.nodeseek\.com\/api\/account\/getInfo\/\d+\?readme=1$ script-path=本脚本URL, requires-body=false, tag=NS捕获Headers

# ② 向 NodeSeek 主页注入签到脚本（主要签到方式，由浏览器执行）
http-response ^https:\/\/www\.nodeseek\.com\/(board|$|post-\d+|personal-center\/.+) script-path=本脚本URL, requires-body=true, max-size=0, tag=NS签到注入

# ③ 每天 00:01 兜底（仅当天未通过浏览器完成签到时触发）
cron "1 0 * * *" script-path=本脚本URL, tag=NS🍗签到兜底, img-url=https://raw.githubusercontent.com/fmz200/wool_scripts/main/icons/author/ZenMoFeiShi.png, enabled=true

[MITM]
hostname = www.nodeseek.com

──────────────────────────────────────────────────────────────────
📋 使用流程：
  1. 配置好以上规则后，在 NodeSeek 点击个人头像（触发 ① 捕获头）
  2. 进入任意 NodeSeek 页面（帖子列表、帖子详情、个人中心等）触发 ②
  3. 页面右上角会出现绿色签到结果提示
  4. 若当天未浏览 NodeSeek，③ 在次日凌晨兜底重试
──────────────────────────────────────────────────────────────────
*/

// ─── 常量 ────────────────────────────────────────────────────────────────────

const NS_HEADER_KEY    = "NS_NodeseekHeaders";
const NS_CHECKIN_DATE  = "NS_LastCheckinDate";

const NEED_KEYS = [
  "Connection", "Accept-Encoding", "Priority", "Content-Type",
  "Origin", "refract-sign", "User-Agent", "refract-key",
  "Sec-Fetch-Mode", "Cookie", "Host", "Referer",
  "Accept-Language", "Accept",
];

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function pickNeedHeaders(src) {
  src = src || {};
  const dst = {};
  const get = (k) => src[k] ?? src[k.toLowerCase()] ?? src[k.toUpperCase()];
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

// 安全转义，防止注入的字符串破坏 JS 代码
function escapeForJS(str) {
  return String(str || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

// ─── 模式检测 ─────────────────────────────────────────────────────────────────

const hasRequest  = typeof $request  !== "undefined";
const hasResponse = typeof $response !== "undefined";

// ═══════════════════════════════════════════════════════════════════════════════
// 模式 1：http-request rewrite ── 捕获请求头
// ═══════════════════════════════════════════════════════════════════════════════
if (hasRequest && !hasResponse) {

  const allHeaders = $request.headers || {};
  const picked     = pickNeedHeaders(allHeaders);

  if (!picked || Object.keys(picked).length === 0) {
    console.log("[NS] 未捕获到有效请求头");
    $notification.post("NS Headers 获取失败", "", "未获取到请求头，请重新访问个人页面。");
    $done({});
    return;
  }

  $persistentStore.write(JSON.stringify(picked), NS_HEADER_KEY);

  const cookieStr  = picked["Cookie"] || "";
  const hasCfClear = cookieStr.indexOf("cf_clearance") !== -1;
  const hasPjwt    = cookieStr.indexOf("pjwt=")        !== -1;
  const hasSign    = (picked["refract-sign"] || "").length > 0;

  console.log("[NS] cf_clearance=" + hasCfClear + " pjwt=" + hasPjwt + " refract-sign=" + hasSign);

  if (!hasCfClear) {
    $notification.post(
      "NS Headers ⚠️",
      "缺少 cf_clearance",
      "Cookie 中未检测到 cf_clearance，页面注入方式可能失败。\n建议退出并重新进入 NodeSeek，等待 Cloudflare 验证通过后再试。"
    );
  } else {
    $notification.post("NS Headers 已更新", "请求头捕获成功 ✅", "现在浏览 NodeSeek 任意页面即可自动签到。");
  }

  $done({});
  return;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 模式 2：http-response rewrite ── 向 HTML 页面注入签到脚本（主要签到方式）
//
//   原理：浏览器执行注入的 fetch()，其 TLS 指纹与 cf_clearance 完全匹配，
//         credentials:'include' 让浏览器自动携带所有 Cookie，无需手动管理。
// ═══════════════════════════════════════════════════════════════════════════════
if (hasRequest && hasResponse) {

  // 只处理 HTML 页面
  const ct = ($response.headers["Content-Type"] || $response.headers["content-type"] || "").toLowerCase();
  if (ct.indexOf("text/html") === -1) {
    $done({});
    return;
  }

  // 已签到则直接放行
  if (isCheckedInToday()) {
    $done({});
    return;
  }

  // 读取已保存的 refract-sign / refract-key（用于 NodeSeek 自身的鉴权）
  let refractSign = "";
  let refractKey  = "";

  const raw = $persistentStore.read(NS_HEADER_KEY);
  if (raw) {
    try {
      const saved = JSON.parse(raw);
      refractSign = escapeForJS(saved["refract-sign"] || "");
      refractKey  = escapeForJS(saved["refract-key"]  || "");
    } catch (e) {
      console.log("[NS] parse saved headers failed: " + e);
    }
  }

  // 乐观标记（注入的 JS 由浏览器执行，脚本无法等待其结果）
  markCheckedIn();

  // 构造注入脚本：
  //   - credentials:'include' → 浏览器自动携带 cf_clearance 等所有 Cookie
  //   - refract-sign/key 来自 Loon 持久化存储
  //   - 签到成功/失败均在页面右上角显示 Toast
  const injectJS = `<script id="_ns_ci_loon_">
(function(){
  if(sessionStorage.getItem('_nsCI_')){return;}
  sessionStorage.setItem('_nsCI_','1');
  setTimeout(function(){
    fetch('/api/attendance?random=true',{
      method:'POST',
      credentials:'include',
      headers:{
        'Content-Type':'text/plain;charset=UTF-8',
        'Origin':'https://www.nodeseek.com',
        'refract-sign':'${refractSign}',
        'refract-key':'${refractKey}'
      }
    }).then(function(r){return r.json();}).then(function(d){
      var msg=d.message||'签到成功';
      console.log('[NS签到]',msg);
      var el=document.createElement('div');
      el.style='position:fixed;top:16px;right:16px;background:#22c55e;color:#fff;padding:10px 18px;'
        +'border-radius:8px;z-index:99999;font-size:13px;font-weight:500;'
        +'box-shadow:0 4px 16px rgba(0,0,0,.25);transition:opacity .4s;';
      el.textContent='🍗 NS签到：'+msg;
      document.body.appendChild(el);
      setTimeout(function(){el.style.opacity='0';setTimeout(function(){el.remove();},400);},3000);
    }).catch(function(e){
      console.error('[NS签到] 失败:',e);
    });
  },800);
})();
</script>`;

  let body = $response.body || "";

  if (body.indexOf("</body>") !== -1) {
    body = body.replace("</body>", injectJS + "</body>");
  } else {
    // 没有 </body> 则追加到末尾
    body = body + injectJS;
  }

  $done({ body: body });
  return;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 模式 3：cron 兜底任务
//   - 若今天已通过页面注入完成签到，直接跳过
//   - 否则尝试 $httpClient（仍可能遇到 Cloudflare，但作为兜底保留）
// ═══════════════════════════════════════════════════════════════════════════════

if (isCheckedInToday()) {
  $notification.post("NS签到", "今日已签到 ✅", "已通过浏览器页面注入完成，无需重试。");
  $done();
  return;
}

const raw = $persistentStore.read(NS_HEADER_KEY);
if (!raw) {
  $notification.post("NS签到结果", "无法签到", "本地没有已保存的请求头，请先在 NodeSeek 访问个人页面。");
  $done();
  return;
}

let savedHeaders = {};
try {
  savedHeaders = JSON.parse(raw) || {};
} catch (e) {
  $notification.post("NS签到结果", "数据损坏", "请重新访问个人页面更新请求头。");
  $done();
  return;
}

const url = "https://www.nodeseek.com/api/attendance?random=true";
const headers = {
  "Content-Type":    savedHeaders["Content-Type"]    || "text/plain;charset=UTF-8",
  "Origin":          savedHeaders["Origin"]          || "https://www.nodeseek.com",
  "refract-sign":    savedHeaders["refract-sign"]    || "",
  "User-Agent":      savedHeaders["User-Agent"]      ||
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7.2 Mobile/15E148 Safari/604.1",
  "refract-key":     savedHeaders["refract-key"]     || "",
  "Sec-Fetch-Mode":  savedHeaders["Sec-Fetch-Mode"]  || "cors",
  "Cookie":          savedHeaders["Cookie"]          || "",
  "Referer":         savedHeaders["Referer"]         || "https://www.nodeseek.com/",
  "Accept-Language": savedHeaders["Accept-Language"] || "zh-CN,zh-Hans;q=0.9",
  "Accept":          savedHeaders["Accept"]          || "*/*",
};

console.log("[NS签到cron] Cookie前30: " + (headers["Cookie"] || "").slice(0, 30));
console.log("[NS签到cron] cf_clearance: " + ((headers["Cookie"] || "").indexOf("cf_clearance") !== -1));

$httpClient.post({ url: url, headers: headers, body: "" }, function(error, response, data) {
  if (error) {
    $notification.post("NS签到结果", "请求错误", String(error || ""));
    $done();
    return;
  }

  const status = response.status;
  const body   = data || "";

  if (body.indexOf("Just a moment") !== -1 || body.indexOf("challenges.cloudflare") !== -1) {
    $notification.post(
      "NS签到结果", "Cloudflare 拦截 🚫",
      "兜底任务仍被 Cloudflare 拦截。\n请今天打开 NodeSeek 任意页面，签到将自动在页面内完成。"
    );
    $done();
    return;
  }

  let msg = "";
  try {
    const obj = JSON.parse(body);
    msg = obj && obj.message ? String(obj.message) : "";
  } catch (e) {}

  if (status >= 200 && status < 300) {
    markCheckedIn();
    $notification.post("NS签到结果", "签到成功 ✅", msg || "签到成功");
  } else if (status === 403) {
    $notification.post("NS签到结果", "403 风控", msg || body.slice(0, 100));
  } else if (status === 500) {
    $notification.post("NS签到结果", "500 服务器错误", msg || body.slice(0, 100));
  } else {
    $notification.post("NS签到结果", "异常 " + status, msg || body.slice(0, 100));
  }

  $done();
});
