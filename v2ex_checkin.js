/**
 * @name         V2EX 签到
 * @author       凉心
 * @version      1.1.0
 * @description  每日自动签到
 * @timestamp    2026-04-26
 */

const KEY = "v2ex_cookie";
const N = (t, s) => $notification.post("V2EX", t, s || "");

if (typeof $request !== "undefined") {
    let cookie = $request.headers?.Cookie || $request.headers?.cookie || "";
    if (cookie) {
        let old = $persistentStore.read(KEY);
        if (old !== cookie) {
            $persistentStore.write(cookie, KEY);
            N("Cookie 已更新");
        }
    }
    $done({});
} else {
    const G = u => new Promise((r, j) => $httpClient.get({ url: u, headers: { Cookie: $persistentStore.read(KEY), "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", Referer: "https://www.v2ex.com/mission/daily" } }, (e, _, b) => e ? j(e) : r(b)));

    function formatBalance(html) {
        let b = html.match(/balance_area bigger[\s\S]*?<\/div>/);
        if (!b) return "";
        let g = (b[0].match(/(\d+)\s*<img[^>]*alt="G"/) || [])[1];
        let s = (b[0].match(/(\d+)\s*<img[^>]*alt="S"/) || [])[1];
        let c = (b[0].match(/(\d+)\s*<img[^>]*alt="B"/) || [])[1];
        let r = "";
        if (g) r += g + "金";
        if (s) r += s + "银";
        if (c) r += c + "铜";
        return r;
    }

    !(async () => {
        if (!$persistentStore.read(KEY)) { N("未获取到 Cookie", "请先访问 V2EX 个人主页"); return $done(); }
        try {
            let h = await G("https://www.v2ex.com/mission/daily");
            if (h.includes("需要先登录")) { N("Cookie 已失效"); return $done(); }

            let days = (h.match(/已连续登录\s*(\d+)\s*天/) || [])[1];
            let once = (h.match(/redeem\?once=(\d+)/) || [])[1];

            if (once) {
                await G(`https://www.v2ex.com/mission/daily/redeem?once=${once}`);
                let h2 = await G("https://www.v2ex.com/mission/daily");
                days = (h2.match(/已连续登录\s*(\d+)\s*天/) || [])[1] || days;
                let reward = ((await G("https://www.v2ex.com/balance")).match(/每日登录奖励\s*([+-]?\d+)\s*铜币/) || [])[1];
                N(`签到成功 | 连续 ${days || "?"} 天${reward ? " | 奖励" + reward + "铜币" : ""}`);
            } else if (h.includes("每日登录奖励已领取")) {
                let bp = await G("https://www.v2ex.com/balance");
                let bal = formatBalance(bp);
                N(`今日已签到 | 连续 ${days || "?"} 天${bal ? " | 余额 " + bal : ""}`);
            } else {
                N("签到失败", "未找到 once");
            }
        } catch (e) { N("脚本异常", e.message || e); }
        $done();
    })();
}
