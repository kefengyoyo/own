/**
 * @name         V2EX 签到
 * @author       凉心 (Egern移植)
 * @version      1.2.0-egern
 * @description  Egern版每日自动签到
 *
 * ===== Egern 配置示例 =====
 * [Script]
 * - name: V2EX 每日签到
 *   type: cron
 *   cron: 0 9 * * *
 *   script-path: v2ex_checkin_egern.js
 */

const KEY = "v2ex_cookie";

// 通知封装
function notify(title, subtitle) {
    $notification.post("V2EX", title, subtitle || "");
}

// 余额格式化
function formatBalance(html) {
    if (!html) return "";
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

// HTTP GET 封装 (Egern版) - 使用 $httpClient.get
function httpGet(url, callback) {
    const cookie = $store.read(KEY);
    if (!cookie) {
        callback(new Error("未获取 Cookie"), null);
        return;
    }

    $httpClient.get({
        url: url,
        headers: {
            Cookie: cookie,
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
            Referer: "https://www.v2ex.com/mission/daily",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
    }, function(error, response, body) {
        if (error) {
            callback(new Error(error || "请求失败"), null);
            return;
        }
        callback(null, body);
    });
}

// 主逻辑 - 回调链
function main() {
    const cookie = $store.read(KEY);
    if (!cookie) {
        notify("❌ 未获取到 Cookie", "请先访问 V2EX 任务页面获取 Cookie");
        $done();
        return;
    }

    // 第一步：获取任务页面
    httpGet("https://www.v2ex.com/mission/daily", function(err, h) {
        if (err) {
            notify("❌ 请求失败", err.message || String(err));
            $done();
            return;
        }

        // 检查登录状态
        if (h.includes("需要先登录") || h.includes("signin")) {
            notify("❌ Cookie 已失效", "请重新访问任务页面获取新 Cookie");
            $done();
            return;
        }

        // 提取连续登录天数
        let days = (h.match(/已连续登录\s*(\d+)\s*天/) || [])[1];

        // 提取 once 参数
        let once = (h.match(/redeem\?once=(\d+)/) || [])[1];

        if (once) {
            // 第二步：执行签到
            httpGet(`https://www.v2ex.com/mission/daily/redeem?once=${once}`, function(err2, h2) {
                if (err2) {
                    notify("❌ 签到请求失败", err2.message || String(err2));
                    $done();
                    return;
                }

                // 第三步：验证签到结果
                httpGet("https://www.v2ex.com/mission/daily", function(err3, h3) {
                    if (err3) {
                        notify("❌ 验证失败", err3.message || String(err3));
                        $done();
                        return;
                    }

                    days = (h3.match(/已连续登录\s*(\d+)\s*天/) || [])[1] || days;

                    // 第四步：获取余额
                    httpGet("https://www.v2ex.com/balance", function(err4, balanceHtml) {
                        let reward = "";
                        let bal = "";

                        if (!err4 && balanceHtml) {
                            reward = (balanceHtml.match(/每日登录奖励\s*([+-]?\d+)\s*铜币/) || [])[1];
                            bal = formatBalance(balanceHtml);
                        }

                        let msg = `连续 ${days || "?"} 天`;
                        if (reward) msg += ` | +${reward} 铜币`;
                        if (bal) msg += ` | 余额 ${bal}`;

                        notify("✅ 签到成功", msg);
                        $done();
                    });
                });
            });
        } else if (h.includes("每日登录奖励已领取")) {
            // 已签到，获取余额
            httpGet("https://www.v2ex.com/balance", function(err2, bp) {
                let bal = "";
                if (!err2 && bp) {
                    bal = formatBalance(bp);
                }

                let msg = `连续 ${days || "?"} 天`;
                if (bal) msg += ` | 余额 ${bal}`;

                notify("✅ 今日已签到", msg);
                $done();
            });
        } else {
            notify("⚠️ 签到失败", "未找到 once 参数，可能页面结构已变化");
            $done();
        }
    });
}

// 执行主逻辑
main();
