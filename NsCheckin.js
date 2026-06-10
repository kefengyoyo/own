// NS 论坛签到 - Loon v4
// 单独保存 attendance Headers，优先使用，避免被 getInfo 覆盖。

/*
#!name=NS论坛签到 Loon v4
#!desc=推荐手动点一次签到抓取 attendance Headers 后再定时签到。版本：2026.06.10-v4

[Script]
http-request ^https:\/\/www\.nodeseek\.com\/api\/account\/getInfo\/\d+\?readme=1$ script-path=https://你的脚本地址/Nodeseek_NsCheckin_Loon_v4.js, requires-body=false, timeout=30, tag=NS🍗获取基础Headers-v4
http-request ^https:\/\/www\.nodeseek\.com\/api\/attendance\?random=true$ script-path=https://你的脚本地址/Nodeseek_NsCheckin_Loon_v4.js, requires-body=false, timeout=30, tag=NS🍗获取签到Headers-v4
cron "1 0 * * *" script-path=https://你的脚本地址/Nodeseek_NsCheckin_Loon_v4.js, timeout=60, tag=NS🍗签到-v4

[MITM]
hostname = %APPEND% www.nodeseek.com
*/

const VERSION = "2026.06.10-v4";
const KEY_ATTENDANCE = "NS_NodeseekHeaders_attendance_v4";
const KEY_GETINFO = "NS_NodeseekHeaders_getInfo_v4";
const isReq = typeof $request !== "undefined";
console.log(`[NS] Loon script loaded, version=${VERSION}`);

function notify(t, s, b) {
  if (typeof $notification !== "undefined" && $notification.post) $notification.post(t, s || "", b || "");
  else if (typeof $notify !== "undefined") $notify(t, s || "", b || "");
  else console.log(`${t} ${s || ""} ${b || ""}`);
}
function done(v) { if (typeof $done !== "undefined") $done(v || {}); }
const store = {
  read(k) { if (typeof $persistentStore !== "undefined") return $persistentStore.read(k); if (typeof $prefs !== "undefined") return $prefs.valueForKey(k); return null; },
  write(v, k) { if (typeof $persistentStore !== "undefined") return $persistentStore.write(v, k); if (typeof $prefs !== "undefined") return $prefs.setValueForKey(v, k); return false; }
};
function hv(h, n) { return (h && (h[n] || h[n.toLowerCase()] || h[n.toUpperCase()])) || ""; }
function typeOfUrl(u) {
  if (/\/api\/attendance\?random=true/.test(u || "")) return "attendance";
  if (/\/api\/account\/getInfo\/\d+\?readme=1/.test(u || "")) return "getInfo";
  return "unknown";
}
function normalize(src) {
  const out = {};
  Object.keys(src || {}).forEach(k => {
    const v = src[k];
    const lk = k.toLowerCase();
    if (v === undefined || v === null || String(v) === "") return;
    if (lk === "content-length" || lk.startsWith(":")) return;
    out[k] = String(v);
  });
  if (!hv(out, "Host")) out["Host"] = "www.nodeseek.com";
  if (!hv(out, "Origin")) out["Origin"] = "https://www.nodeseek.com";
  if (!hv(out, "Referer")) out["Referer"] = "https://www.nodeseek.com/";
  if (!hv(out, "Accept")) out["Accept"] = "*/*";
  if (!hv(out, "Content-Type")) out["Content-Type"] = "text/plain;charset=UTF-8";
  return out;
}
function hasCf(h) { return /(?:^|;\s*)cf_clearance=/.test(hv(h, "Cookie")); }
function keys(h) { return Object.keys(h || {}).filter(k => k.toLowerCase() !== "cookie").join(", "); }
function saveHeaders() {
  const url = ($request && $request.url) || "";
  const type = typeOfUrl(url);
  const headers = normalize(($request && $request.headers) || {});
  const key = type === "attendance" ? KEY_ATTENDANCE : KEY_GETINFO;
  const payload = { version: VERSION, type, url, savedAt: new Date().toISOString(), headers };
  const ok = store.write(JSON.stringify(payload), key);
  const cf = hasCf(headers) ? "是" : "否";
  console.log(`[NS] saved ${type} headers to ${type === "attendance" ? "attendance-key" : "getInfo-key"}, cf_clearance=${cf}, keys=${keys(headers)}`);
  notify(ok ? "NS Headers 获取成功" : "NS Headers 保存失败", `类型：${type}，cf_clearance：${cf}`, type === "attendance" ? "已保存真实签到 Headers，将优先用于定时签到。" : "已保存基础 Headers；仍建议手动点一次签到抓 attendance Headers。");
  done({});
}
function readSaved() {
  let raw = store.read(KEY_ATTENDANCE);
  if (raw) return { raw, source: "attendance" };
  raw = store.read(KEY_GETINFO);
  if (raw) return { raw, source: "getInfo" };
  return null;
}
function post(opt, cb) {
  if (typeof $httpClient !== "undefined") return $httpClient.post(opt, cb);
  if (typeof $task !== "undefined") return $task.fetch(opt).then(r => cb(null, r, r.body || ""), e => cb(e, null, ""));
  cb(new Error("no http client"), null, "");
}
function preview(b) { return String(b || "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300); }
function checkin() {
  const item = readSaved();
  if (!item) { notify("NS签到结果", "无法签到", "未保存 Headers。请先手动点一次签到，抓取 attendance Headers。"); return done(); }
  let saved;
  try { saved = JSON.parse(item.raw); } catch (e) { notify("NS签到结果", "无法签到", "Headers 数据损坏，请重新抓取。"); return done(); }
  const headers = normalize(saved.headers || {});
  console.log(`[NS] use saved source=${item.source}, type=${saved.type}, savedAt=${saved.savedAt}, cf_clearance=${hasCf(headers) ? "yes" : "no"}`);
  if (item.source !== "attendance") console.log("[NS] warning: no attendance headers found; using getInfo fallback.");
  post({ url: "https://www.nodeseek.com/api/attendance?random=true", method: "POST", headers, body: "" }, (err, resp, data) => {
    if (err) { notify("NS签到结果", "请求错误", String((err && err.error) || err)); return done(); }
    const status = Number(resp && (resp.status || resp.statusCode)) || 0;
    const body = data || (resp && resp.body) || "";
    let msg = "", isJson = false;
    try { const obj = JSON.parse(body); isJson = true; msg = obj && obj.message ? String(obj.message) : JSON.stringify(obj).slice(0, 300); console.log(`[NS] json response, status=${status}, message=${msg}`); }
    catch (e) { msg = preview(body) || String(body).slice(0, 300); console.log(`[NS] non-json response, status=${status}, preview=${msg}`); }
    if (!isJson && /Just a moment|Enable JavaScript and cookies|Cloudflare/i.test(msg)) notify("NS签到结果", "Cloudflare 403", item.source === "attendance" ? "已使用真实签到 Headers 仍被拦截，基本是 Loon 后台 TLS/浏览器指纹不被 Cloudflare 接受。" : "当前还没抓到 attendance Headers，请先手动点一次签到。");
    else if (status >= 200 && status < 300) notify("NS签到结果", "签到成功", msg || "成功，但无返回内容");
    else notify("NS签到结果", `请求异常 ${status}`, msg || `status=${status}`);
    done();
  });
}
if (isReq) saveHeaders(); else checkin();
