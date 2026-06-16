/**
 * Sub-Store 脚本操作：按「协议类型」给节点名加前缀
 * 用法：Sub-Store -> 订阅/组合订阅 -> 节点操作 -> 添加「脚本操作（节点操作）」
 * 原理：读取 proxy.type（协议字段），与节点名无关，机场改名也不失效
 *
 * 可选参数（脚本链接后加 #，多个用 & 连接）：
 *   #only=hysteria2        只给指定协议加前缀（多个用逗号，如 only=hysteria2,tuic）
 *   #fgf=空格分隔符        前缀与原名之间的分隔符，默认一个空格
 *   #brackets=off          关闭中括号，输出 "HY2 节点名" 而非 "[HY2] 节点名"
 */
function operator(proxies, targetPlatform, context) {
  const args = (typeof $arguments !== "undefined" && $arguments) || {};
  const only = args.only
    ? String(args.only).toLowerCase().split(",").map((s) => s.trim())
    : null;
  const sep = args.fgf !== undefined ? decodeURIComponent(args.fgf) : " ";
  const useBrackets = String(args.brackets) !== "off";

  // 协议 -> 显示标签
  const LABEL = {
    hysteria2: "HY2",
    hysteria: "HY",
    tuic: "TUIC",
    vless: "VLESS",
    vmess: "VMess",
    trojan: "Trojan",
    ss: "SS",
    shadowsocks: "SS",
    ssr: "SSR",
    shadowsocksr: "SSR",
    wireguard: "WG",
    snell: "Snell",
    anytls: "AnyTLS",
    juicity: "Juicity",
    http: "HTTP",
    socks5: "SOCKS5",
  };

  proxies.forEach((p) => {
    const t = String(p.type || "").toLowerCase();
    if (only && !only.includes(t)) return;
    const label = LABEL[t];
    if (!label) return;
    const tag = useBrackets ? "[" + label + "]" : label;
    const prefix = tag + sep;
    // 幂等：已加过同标签则跳过，避免重复叠加
    if (!p.name.startsWith(tag)) {
      p.name = prefix + p.name;
    }
  });

  return proxies;
}
