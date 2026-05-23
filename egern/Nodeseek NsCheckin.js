// NodeSeek 签到脚本 - Egern 适配版
// 原作者：怎么肥事 https://github.com/ZenmoFeiShi/Qx
// Egern 适配：将 QX API 转换为 Egern ctx API

const NS_HEADER_KEY = "NS_NodeseekHeaders";

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

export default async function (ctx) {
  const isGetHeader = typeof ctx.request !== "undefined";

  if (isGetHeader) {
    // ── 获取 Cookie 模式（http_request 脚本触发）──
    const allHeaders = ctx.request.headers;
    const picked = {};

    for (const k of NEED_KEYS) {
      const v = allHeaders.get(k);
      if (v !== null && v !== undefined) picked[k] = v;
    }

    if (!picked || Object.keys(picked).length === 0) {
      console.log("[NS] picked headers empty");
      ctx.notify({
        title: "NS Headers 获取失败",
        body: "未获取到指定请求头，请重新访问一次个人页面。",
      });
      return;
    }

    try {
      ctx.storage.setJSON(NS_HEADER_KEY, picked);
      console.log("[NS] saved picked headers:", JSON.stringify(picked));
      ctx.notify({
        title: "NS Headers 获取成功",
        body: "指定请求头已持久化保存，可执行签到任务。",
      });
    } catch (e) {
      console.log("[NS] storage write failed:", e);
      ctx.notify({
        title: "NS Headers 保存失败",
        body: "写入持久化存储失败，请检查配置。",
      });
    }

    return;

  } else {
    // ── 签到模式（schedule 脚本触发）──
    const savedHeaders = ctx.storage.getJSON(NS_HEADER_KEY);

    if (!savedHeaders || Object.keys(savedHeaders).length === 0) {
      ctx.notify({
        title: "NS签到结果",
        subtitle: "无法签到",
        body: "本地没有已保存的请求头，请先打开 NodeSeek 个人页面触发抓包。",
      });
      return;
    }

    const headers = {
      Connection: savedHeaders["Connection"] || "keep-alive",
      "Accept-Encoding": savedHeaders["Accept-Encoding"] || "gzip, deflate, br",
      Priority: savedHeaders["Priority"] || "u=3, i",
      "Content-Type": savedHeaders["Content-Type"] || "text/plain;charset=UTF-8",
      Origin: savedHeaders["Origin"] || "https://www.nodeseek.com",
      "refract-sign": savedHeaders["refract-sign"] || "",
      "User-Agent":
        savedHeaders["User-Agent"] ||
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7.2 Mobile/15E148 Safari/604.1",
      "refract-key": savedHeaders["refract-key"] || "",
      "Sec-Fetch-Mode": savedHeaders["Sec-Fetch-Mode"] || "cors",
      Cookie: savedHeaders["Cookie"] || "",
      Host: savedHeaders["Host"] || "www.nodeseek.com",
      Referer: savedHeaders["Referer"] || "https://www.nodeseek.com/sw.js?v=0.3.33",
      "Accept-Language": savedHeaders["Accept-Language"] || "zh-CN,zh-Hans;q=0.9",
      Accept: savedHeaders["Accept"] || "*/*",
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
        console.log(`[NS签到] parsed message: ${msg || "(empty)"}`);
      } catch (e) {
        console.log(`[NS签到] JSON parse failed: ${e}`);
      }

      if (status === 403) {
        ctx.notify({
          title: "NS签到结果",
          subtitle: "403 风控",
          body: `暂时被风控，稍后再试${msg ? `\n内容：${msg}` : ""}`,
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
          body: msg || "NS签到成功，但未返回 message",
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
}
