/**
 * @name         V2EX Cookie获取
 * @author       凉心 (Egern移植)
 * @version      1.2.0-egern
 * @description  Egern版Cookie获取脚本
 *
 * ===== Egern 配置示例 =====
 * [Script]
 * - name: V2EX Cookie获取
 *   type: request
 *   pattern: ^https://www\.v2ex\.com/mission/daily
 *   script-path: v2ex_cookie_egern.js
 */

const KEY = "v2ex_cookie";

if (typeof $request !== "undefined") {
    let cookie = ($request.headers && ($request.headers["Cookie"] || $request.headers["cookie"])) || "";
    if (cookie) {
        let old = $store.read(KEY);
        if (old !== cookie) {
            $store.write(cookie, KEY);
            $notification.post("V2EX", "✅ Cookie 已更新", "可禁用获取规则");
        } else {
            $notification.post("V2EX", "ℹ️ Cookie 未变化", "当前 Cookie 仍然有效");
        }
    } else {
        $notification.post("V2EX", "⚠️ 未获取到 Cookie", "请确保已登录 V2EX");
    }
    $done({});
} else {
    $notification.post("V2EX", "❌ 脚本调用错误", "此脚本仅用于获取 Cookie，需配置为 request 类型");
    $done({});
}
