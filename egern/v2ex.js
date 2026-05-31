/**
 * V2EX 每日签到 - Egern 原生脚本
 * 作者：Curtinp118（Egern 重写适配）
 *
 * 工作原理：
 *  - http_request 脚本：访问 v2ex.com/mission 或 /member 页面时，
 *    自动从请求头提取 Cookie 并存入持久化存储。
 *  - schedule 脚本：每天 09:10 读取存储的 Cookie，完成自动签到。
 */

const COOKIE_KEY = "V2EX_Cookie";

const COMMON_HEADERS = {
  "Accept": "*/*",
  "Accept-Language": "en,zh-CN;q=0.9,zh;q=0.8",
  "Cache-Control": "max-age=0",
  "Pragma": "no-cache",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Referer": "https://www.v2ex.com/"
};

function buildHeaders(cookie) {
  return Object.assign({}, COMMON_HEADERS, { Cookie: cookie });
}

async function fetchText(ctx, url, cookie) {
  const resp = await ctx.http.get(url, { headers: buildHeaders(cookie) });
  const body = await resp.text();
  console.log(`[V2EX] ${url} -> ${resp.status} (${body.length} bytes)`);
  return body;
}

function formatBalance(html) {
  try {
    const block = html.match(/balance_area bigger[\s\S]*?<\/div>/);
    if (!block) return "";
    const gold   = (block[0].match(/(\d+)\s*<img.*?alt="G"/) || [])[1] || "0";
    const silver = (block[0].match(/(\d+)\s*<img.*?alt="S"/) || [])[1] || "0";
    const bronze = (block[0].match(/(\d+)\s*<img.*?alt="B"/) || [])[1] || "0";
    return `${gold} 金币, ${silver} 银币, ${bronze} 铜币`;
  } catch (e) {
    return "";
  }
}

async function getOnce(ctx, cookie) {
  const html = await fetchText(ctx, "https://www.v2ex.com/mission/daily", cookie);
  if (!html) return { once: "", logged_in: false, already: false, days: "?" };
  if (html.includes("你要查看的页面需要先登录") || html.includes("需要先登录")) {
    return { once: "", logged_in: false, already: false, days: "?" };
  }
  const daysMatch = html.match(/已连续登录\s*(\d+)\s*天/);
  const days = daysMatch ? daysMatch[1] : "?";
  if (html.includes("每日登录奖励已领取")) {
    return { once: "", logged_in: true, already: true, days };
  }
  const onceMatch = html.match(/once=(\d+)/);
  return { once: onceMatch ? onceMatch[1] : "", logged_in: true, already: false, days };
}

async function queryBalance(ctx, cookie) {
  const html = await fetchText(ctx, "https://www.v2ex.com/balance", cookie);
  const rewardMatch = html.match(/\d+ 的每日登录奖励 \d+ 铜币/);
  const bonusMatch  = html.match(/每日登录奖励\s*([+-]?\d+)\s*铜币/);
  return {
    reward:  rewardMatch ? rewardMatch[0] : "",
    bonus:   bonusMatch  ? bonusMatch[1]  : "",
    balance: formatBalance(html)
  };
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function doCheckin(ctx, cookie, attempt = 0, maxRetry = 3) {
  console.log(`[V2EX] Attempt ${attempt + 1}/${maxRetry}`);
  try {
    const info = await getOnce(ctx, cookie);

    if (!info.logged_in) {
      ctx.notify({ title: "V2EX", subtitle: "Cookie 已失效", body: "请重新访问 V2EX 更新 Cookie" });
      return;
    }

    if (info.already) {
      const q = await queryBalance(ctx, cookie);
      let body = `连续签到 ${info.days} 天`;
      if (q.balance) body += `\n${q.balance}`;
      ctx.notify({ title: "V2EX 今日已签到", body });
      return;
    }

    if (!info.once) {
      if (attempt + 1 < maxRetry) {
        await sleep(3000);
        return doCheckin(ctx, cookie, attempt + 1, maxRetry);
      }
      ctx.notify({ title: "V2EX 签到失败", body: "未找到 once 码，已达最大重试次数" });
      return;
    }

    console.log(`[V2EX] once=${info.once} | 连续 ${info.days} 天`);
    await fetchText(ctx, `https://www.v2ex.com/mission/daily/redeem?once=${info.once}`, cookie);
    const q = await queryBalance(ctx, cookie);
    let body = `连续签到 ${info.days} 天`;
    if (q.reward)  body += `\n${q.reward}`;
    if (q.balance) body += `\n余额 ${q.balance}`;
    ctx.notify({ title: "V2EX 签到成功", body });

  } catch (e) {
    const msg = e && (e.message || String(e)) || "Unknown error";
    console.log(`[V2EX] Error: ${msg}`);
    if (attempt + 1 < maxRetry) {
      await sleep(3000);
      return doCheckin(ctx, cookie, attempt + 1, maxRetry);
    }
    ctx.notify({ title: "V2EX 网络错误", body: msg });
  }
}

export default async function(ctx) {
  // ── 抓包模式：保存 Cookie ──────────────────────────────────────────────
  if (ctx.request) {
    const cookie = ctx.request.headers.get("Cookie") || ctx.request.headers.get("cookie") || "";
    if (!cookie) {
      console.log("[V2EX] Cookie not found in request headers");
      return;
    }
    const old = ctx.storage.get(COOKIE_KEY) || "";
    if (old !== cookie) {
      ctx.storage.set(COOKIE_KEY, cookie);
      console.log("[V2EX] Cookie saved successfully");
      ctx.notify({ title: "V2EX", body: "Cookie 已更新，后续将自动签到" });
    }
    return; // 透传请求，不修改
  }

  // ── 定时签到模式 ───────────────────────────────────────────────────────
  console.log("[V2EX] ===== 签到开始 =====");
  const cookie = ctx.storage.get(COOKIE_KEY) || "";
  if (!cookie) {
    ctx.notify({ title: "V2EX", body: "未获取到 Cookie，请先访问 V2EX 个人主页" });
    return;
  }
  await doCheckin(ctx, cookie);
  console.log("[V2EX] ===== 签到结束 =====");
}
