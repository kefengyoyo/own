// NodeSeek 签到脚本 - Egern 适配版（Task 模块用）
// 原作者：怎么肥事
// 依赖：需先运行 Nodeseek_GetHeaders.js 保存请求头

const NS_HEADER_KEY = "NS_NodeseekHeaders";

export default async function (ctx) {
  const savedHeaders = ctx.storage.getJSON(NS_HEADER_KEY);

  if (!savedHeaders || typeof savedHeaders !== "object" || Object.keys(savedHeaders).length === 0) {
    ctx.notify({
      title: "NS签到结果",
      subtitle: "无法签到",
      body: "本地没有已保存的请求头，请先打开 NodeSeek 个人页面触发抓包。",
    });
    return;
  }

  if (!savedHeaders["Cookie"]) {
    ctx.notify({
      title: "NS签到结果",
      subtitle: "Cookie 缺失",
      body: "已保存的数据中没有 Cookie，请重新访问 NodeSeek 个人页面重新获取。",
    });
    return;
  }

  const headers = {
    "Connection":       savedHeaders["Connection"]      || "keep-alive",
    "Accept-Encoding":  savedHeaders["Accept-Encoding"] || "gzip, deflate, br",
    "Priority":         savedHeaders["Priority"]        || "u=3, i",
    "Content-Type":     savedHeaders["Content-Type"]    || "text/plain;charset=UTF-8",
    "Origin":           savedHeaders["Origin"]          || "https://www.nodeseek.com",
    "refract-sign":     savedHeaders["refract-sign"]    || "",
    "User-Agent":       savedHeaders["User-Agent"]      || "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7.2 Mobile/15E148 Safari/604.1",
    "refract-key":      savedHeaders["refract-key"]     || "",
    "Sec-Fetch-Mode":   savedHeaders["Sec-Fetch-Mode"]  || "cors",
    "Cookie":           savedHeaders["Cookie"],
    "Host":             savedHeaders["Host"]             || "www.nodeseek.com",
    "Referer":          savedHeaders["Referer"]          || "https://www.nodeseek.com/sw.js?v=0.3.33",
    "Accept-Language":  savedHeaders["Accept-Language"]  || "zh-CN,zh-Hans;q=0.9",
    "Accept":           savedHeaders["Accept"]           || "*/*",
  };

  try {
    const resp = await ctx.http.post(
      "https://www.nodeseek.com/api/attendance?random=true",
      { headers, body: "" }
    );

    const status = resp.status;
    let msg = "";

    try {
      const obj = await resp.json();
      msg = obj?.message ? String(obj.message) : "";
      console.log(`[NS签到] status=${status}, message=${msg || "(empty)"}`);
    } catch (e) {
      console.log(`[NS签到] JSON parse failed: ${e}`);
    }

    if (status === 403) {
      ctx.notify({
        title: "NS签到结果",
        subtitle: "403 风控 ⚠️",
        body: `暂时被风控，稍后再试${msg ? `\n${msg}` : ""}`,
      });
    } else if (status === 500) {
      ctx.notify({
        title: "NS签到结果",
        subtitle: "500 服务器错误",
        body: msg || "服务器错误(500)，无返回内容",
      });
    } else if (status >= 200 && status < 300) {
      ctx.notify({
        title: "NS签到结果",
        subtitle: "签到成功 ✅",
        body: msg || "签到成功，但服务器未返回具体信息",
      });
    } else {
      ctx.notify({
        title: "NS签到结果",
        subtitle: `请求异常 ${status}`,
        body: msg || `请求失败，status=${status}`,
      });
    }
  } catch (e) {
    const err = String(e?.message || e || "未知错误");
    console.log(`[NS签到] request error: ${err}`);
    ctx.notify({
      title: "NS签到结果",
      subtitle: "请求错误",
      body: err,
    });
  }
}
