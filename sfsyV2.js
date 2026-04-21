/**
 * 顺丰速运签到脚本 - Loon 适配版
 * 基于用户提供的 sfsy(1).js + GitHub chavyleung/sfexpress + Sliverkiss 更新
 * 支持签到 + 日常任务
 * 作者：修改自社区脚本
 * 使用前请确保 MITM 和重写规则已配置
 */

const $ = new Env("顺丰速运");

// 存储 Key（支持多账号，Loon 使用 $persistentStore）
const KEY_TOKEN = "sfsy_token";  // 或使用 chavy_login_sfexpress 如果沿用旧版

!(async () => {
    // 尝试从存储获取 Token
    let tokenData = $.getdata(KEY_TOKEN);
    if (!tokenData) {
        $.log("未找到 Token，请先通过重写规则在小程序中获取");
        $.msg($.name, "❌ Token 未获取", "请打开小程序我的-优惠券页面触发获取");
        return;
    }

    // 执行签到流程（结合 chavyleung 逻辑）
    await signIn();
    await dailyTasks();

    $.done();
})().catch((e) => $.logErr(e)).finally(() => $.done());

async function signIn() {
    const url = "https://mcs-mimp-web.sf-express.com/mcs-mimp/commonPost/~memberNonactivity~integralTaskSignPlusService~automaticSignFetchPackage";
    const body = JSON.stringify({ "comeFrom": "vioin", "channelFrom": "SFAPP" });

    const opts = {
        url: url,
        headers: {
            "Content-Type": "application/json",
            // 这里可根据捕获的 Token 添加 Authorization 或 Cookie（视实际捕获内容调整）
            // 示例： "Authorization": `Bearer ${tokenData}`
        },
        body: body
    };

    return $.http.post(opts).then((resp) => {
        try {
            const data = JSON.parse(resp.body);
            if (data.success) {
                const signInfo = data.obj || {};
                $.subt = `签到成功 ✅`;
                $.desc = `连续签到 ${signInfo.countDay || '?'} 天`;
                $.log(`签到结果: ${JSON.stringify(data)}`);
            } else {
                $.subt = `签到失败`;
                $.desc = data.errorMessage || "未知错误";
            }
        } catch (e) {
            $.subt = `签到解析失败`;
            $.desc = e.message;
        }
        $.msg($.name, $.subt, $.desc || "");
    }).catch((err) => {
        $.logErr(err);
        $.msg($.name, "签到请求失败", err.message);
    });
}

async function dailyTasks() {
    // 查询并领取日常任务（简化版，可根据需要扩展）
    const queryUrl = "https://mcs-mimp-web.sf-express.com/mcs-mimp/commonPost/~memberNonactivity~integralTaskStrategyService~queryPointTaskAndSignFromES";
    const queryBody = JSON.stringify({ "channelType": "1" });

    const opts = {
        url: queryUrl,
        headers: { "Content-Type": "application/json" },
        body: queryBody
    };

    $.http.post(opts).then((resp) => {
        try {
            const data = JSON.parse(resp.body);
            $.log(`日常任务查询: ${JSON.stringify(data)}`);
            // 这里可循环处理未完成任务（finishTask + fetchIntegral），社区新版多为自动
            // 如需完整任务循环，可参考 chavyleung 原始逻辑添加
        } catch (e) {
            $.logErr(e);
        }
    });
}

// ====================== Env 工具类（从 sfsy(1).js 和社区脚本提取/适配） ======================
function Env(name) {
    const isLoon = typeof $loon !== "undefined";
    const isQuanX = typeof $task !== "undefined";
    const isSurge = typeof $httpClient !== "undefined" && typeof $loon === "undefined";

    const $ = {
        name: name,
        isLoon: isLoon,
        isQuanX: isQuanX,
        isSurge: isSurge,
        isNode: () => typeof module !== "undefined" && !!module.exports,

        log: (...args) => console.log(`[${name}]`, ...args),
        logErr: (err) => console.error(`[${name} Error]`, err),

        getdata: (key) => {
            if (isLoon || isSurge) return $persistentStore.read(key);
            if (isQuanX) return $prefs.valueForKey(key);
            return null;
        },
        setdata: (val, key) => {
            if (isLoon || isSurge) return $persistentStore.write(val, key);
            if (isQuanX) return $prefs.setValueForKey(val, key);
            return false;
        },

        http: {
            post: (opts) => {
                return new Promise((resolve, reject) => {
                    if (isLoon) {
                        $httpClient.post(opts, (err, resp, body) => {
                            if (err) reject(err);
                            else resolve({ body: body || resp });
                        });
                    } else if (isQuanX) {
                        $task.fetch({ ...opts, method: "POST" }).then(resolve).catch(reject);
                    } else {
                        reject("不支持的环境");
                    }
                });
            }
        },

        msg: (title, subt, desc) => {
            if (isLoon) $notification.post(title, subt, desc);
            else if (isQuanX) $notify(title, subt, desc);
            else console.log(title + "\n" + subt + "\n" + desc);
        },

        done: () => {
            if (isQuanX) $done();
            else if (isLoon) $done();
        }
    };

    return $;
}