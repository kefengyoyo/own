// NodeSeek 获取请求头 - Egern 适配版（GetCookies 模块用）
// 原作者：怎么肥事
// 触发方式：打开 NodeSeek，点击个人头像进入信息页面

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
  const allHeaders = ctx.request.headers;
  const picked = {};

  for (const k of NEED_KEYS) {
    // Egern Headers 对象支持大小写不敏感的直接属性访问
    const v = allHeaders[k];
    if (v !== undefined && v !== null && v !== "") {
      // 多值 header 会返回数组，取第一个
      picked[k] = Array.isArray(v) ? v[0] : v;
    }
  }

  if (Object.keys(picked).length === 0) {
    console.log("[NS] picked headers empty, all headers:", JSON.stringify(Object.keys(allHeaders)));
    ctx.notify({
      title: "NS Headers 获取失败",
      body: "未获取到指定请求头，请重新访问一次个人页面。",
    });
    return;
  }

  // Cookie 是核心字段，单独校验
  if (!picked["Cookie"]) {
    ctx.notify({
      title: "NS Headers 获取失败",
      subtitle: "Cookie 为空",
      body: "请确认已登录 NodeSeek 后再访问个人页面。",
    });
    return;
  }

  try {
    ctx.storage.setJSON(NS_HEADER_KEY, picked);
    console.log("[NS] saved headers, keys:", Object.keys(picked).join(", "));
    ctx.notify({
      title: "NS Headers 获取成功 ✅",
      body: `已保存 ${Object.keys(picked).length} 个请求头，Cookie 已就绪。`,
    });
  } catch (e) {
    console.log("[NS] storage write failed:", String(e));
    ctx.notify({
      title: "NS Headers 保存失败",
      body: "写入持久化存储失败，请检查配置。",
    });
  }
}
