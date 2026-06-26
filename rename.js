/**
 * Sub-Store 脚本操作：地区重命名 + 协议类型前缀（合并版）
 *
 * 来源：
 *   地区重命名 → https://raw.githubusercontent.com/Keywos/rule/main/rename.js
 *   协议前缀   → rename.js（本地上传版）
 *
 * 用法：Sub-Store → 订阅/组合订阅 → 节点操作 → 添加「脚本操作（节点操作）」
 *
 * 执行顺序：① 地区重命名 → ② 协议前缀（可单独关闭任一功能）
 * 最终效果示例：[HY2] 香港 01 · [VLESS] 新加坡 GPT 03
 *
 * ════════════════════════════════════════════════════════════════
 * 地区重命名参数（脚本链接后加 #，多个参数用 & 连接）
 * ════════════════════════════════════════════════════════════════
 *
 * [in=]         输入节点名类型，不填则自动按 中文→国旗→英文全称→英文缩写 顺序判断
 *               可选值：zh/cn=中文  flag/gq=国旗  quan=英文全称  en/us=英文缩写
 *
 * [out=]        输出格式，默认中文
 *               可选值：zh/cn=中文  us/en=英文缩写  gq/flag=国旗  quan=英文全称
 *
 * [nm]          保留未匹配到地区的节点（默认丢弃未匹配节点）
 *
 * [fgf=]        地区名各字段间的分隔符，默认空格
 *               例：fgf=%20（空格）  fgf=-（连字符）
 *
 * [sn=]         地区名与序号之间的分隔符，默认空格
 *
 * [one]         只有一个节点的地区不显示序号 01
 *
 * [flag]        在节点名中插入国旗 Emoji
 *               注意：若使用 in=flag，请勿在本脚本前再添加「国旗」操作
 *
 * [name=]       添加机场名称前缀
 *
 * [nf]          将 name= 的值放到最前面（默认跟在国旗后）
 *
 * [blkey=]      保留节点名中的自定义关键词（区分大小写），多个用 + 分隔
 *               支持替换语法：key>新名字，例：blkey=GPT>GPT+NF+IPLC
 *
 * [blgd]        保留 IPLC / IEPL / 家宽 / 游戏 / 专线 等标识字段
 *
 * [bl]          正则匹配并保留倍率标识（如 2×、0.5x、3倍）
 *
 * [nx]          过滤高倍率节点（仅保留 1× 及无倍率节点）
 *
 * [blnx]        只保留高倍率节点
 *
 * [clear]       过滤含「套餐/到期/流量/机场」等字样的节点
 *
 * [blockquic=]  控制节点的 block-quic 字段
 *               blockquic=on=阻止  blockquic=off=不阻止  不填=不修改
 *
 * ════════════════════════════════════════════════════════════════
 * 协议类型前缀参数
 * ════════════════════════════════════════════════════════════════
 *
 * [proto=off]   关闭协议前缀功能（默认开启）
 *
 * [only=]       只给指定协议加前缀，多个用逗号分隔（不区分大小写）
 *               例：only=hysteria2,tuic,vless
 *               支持：hysteria2 · hysteria · tuic · vless · vmess · trojan
 *                     ss · ssr · wireguard · snell · anytls · juicity · http · socks5
 *
 * [brackets=off] 去掉中括号，输出 "HY2 香港 01" 而非 "[HY2] 香港 01"
 *
 * [pfgf=]       协议标签与节点名之间的分隔符，默认一个空格
 *               例：pfgf=%20（空格）  pfgf=-
 *
 * ════════════════════════════════════════════════════════════════
 * 参数组合示例
 * ════════════════════════════════════════════════════════════════
 *
 * 地区重命名 + 协议前缀（全默认）：
 *   rename-merged.js
 *
 * 输出英文缩写 + 国旗 + 只给 HY2/TUIC 加前缀：
 *   rename-merged.js#out=en&flag&only=hysteria2,tuic
 *
 * 保留 GPT/NF 标识 + 保留倍率 + 去中括号：
 *   rename-merged.js#blkey=GPT+NF&bl&brackets=off
 *
 * 只做地区重命名，不加协议前缀：
 *   rename-merged.js#proto=off
 */

// ─────────────────────────────────────────────────────────────────────────────
// 参数解析
// ─────────────────────────────────────────────────────────────────────────────
const inArg = $arguments;

// 地区重命名参数
const nx      = inArg.nx    || false;
const bl      = inArg.bl    || false;
const nf      = inArg.nf    || false;
const blgd    = inArg.blgd  || false;
const blpx    = inArg.blpx  || false;
const blnx    = inArg.blnx  || false;
const numone  = inArg.one   || false;
const clear   = inArg.clear || false;
const addflag = inArg.flag  || false;
const nm      = inArg.nm    || false;
const key     = inArg.key   || false;

const FGF       = inArg.fgf       == null ? " "  : decodeURIComponent(inArg.fgf);
const XHFGF     = inArg.sn        == null ? " "  : decodeURIComponent(inArg.sn);
const FNAME     = inArg.name      == null ? ""   : decodeURIComponent(inArg.name);
const BLKEY     = inArg.blkey     == null ? ""   : decodeURIComponent(inArg.blkey);
const blockquic = inArg.blockquic == null ? ""   : decodeURIComponent(inArg.blockquic);

const nameMap    = { cn:"cn", zh:"cn", us:"us", en:"us", quan:"quan", gq:"gq", flag:"gq" };
const inname     = nameMap[inArg.in]  || "";
const outputName = nameMap[inArg.out] || "";

// 地区重命名开关：检测到任意改名参数时才激活，否则跳过（不改动节点名）
const RENAME_ENABLED =
  inArg.in != null || inArg.out != null ||
  nx || bl || nf || blgd || blpx || blnx || numone || clear || addflag || nm || key ||
  FNAME !== "" || BLKEY !== "" || blockquic !== "" ||
  inArg.fgf != null || inArg.sn != null || inArg.one != null;

// 协议前缀参数
const PROTO_ENABLED = String(inArg.proto) !== "off";
const PROTO_ONLY    = inArg.only
  ? String(inArg.only).toLowerCase().split(",").map((s) => s.trim())
  : null;
const USE_BRACKETS  = String(inArg.brackets) !== "off";
const PROTO_SEP     = inArg.pfgf != null ? decodeURIComponent(inArg.pfgf) : " ";

// ─────────────────────────────────────────────────────────────────────────────
// 协议标签映射
// ─────────────────────────────────────────────────────────────────────────────
const PROTO_LABEL = {
  hysteria2:    "HY2",
  hysteria:     "HY",
  tuic:         "TUIC",
  vless:        "VLESS",
  vmess:        "VMess",
  trojan:       "Trojan",
  ss:           "SS",
  shadowsocks:  "SS",
  ssr:          "SSR",
  shadowsocksr: "SSR",
  wireguard:    "WG",
  snell:        "Snell",
  anytls:       "AnyTLS",
  juicity:      "Juicity",
  http:         "HTTP",
  socks5:       "SOCKS5",
};

// ─────────────────────────────────────────────────────────────────────────────
// 国家/地区数据表
// ─────────────────────────────────────────────────────────────────────────────
// prettier-ignore
const FG = ['🇭🇰','🇲🇴','🇹🇼','🇯🇵','🇰🇷','🇸🇬','🇺🇸','🇬🇧','🇫🇷','🇩🇪','🇦🇺','🇦🇪','🇦🇫','🇦🇱','🇩🇿','🇦🇴','🇦🇷','🇦🇲','🇦🇹','🇦🇿','🇧🇭','🇧🇩','🇧🇾','🇧🇪','🇧🇿','🇧🇯','🇧🇹','🇧🇴','🇧🇦','🇧🇼','🇧🇷','🇻🇬','🇧🇳','🇧🇬','🇧🇫','🇧🇮','🇰🇭','🇨🇲','🇨🇦','🇨🇻','🇰🇾','🇨🇫','🇹🇩','🇨🇱','🇨🇴','🇰🇲','🇨🇬','🇨🇩','🇨🇷','🇭🇷','🇨🇾','🇨🇿','🇩🇰','🇩🇯','🇩🇴','🇪🇨','🇪🇬','🇸🇻','🇬🇶','🇪🇷','🇪🇪','🇪🇹','🇫🇯','🇫🇮','🇬🇦','🇬🇲','🇬🇪','🇬🇭','🇬🇷','🇬🇱','🇬🇹','🇬🇳','🇬🇾','🇭🇹','🇭🇳','🇭🇺','🇮🇸','🇮🇳','🇮🇩','🇮🇷','🇮🇶','🇮🇪','🇮🇲','🇮🇱','🇮🇹','🇨🇮','🇯🇲','🇯🇴','🇰🇿','🇰🇪','🇰🇼','🇰🇬','🇱🇦','🇱🇻','🇱🇧','🇱🇸','🇱🇷','🇱🇾','🇱🇹','🇱🇺','🇲🇰','🇲🇬','🇲🇼','🇲🇾','🇲🇻','🇲🇱','🇲🇹','🇲🇷','🇲🇺','🇲🇽','🇲🇩','🇲🇨','🇲🇳','🇲🇪','🇲🇦','🇲🇿','🇲🇲','🇳🇦','🇳🇵','🇳🇱','🇳🇿','🇳🇮','🇳🇪','🇳🇬','🇰🇵','🇳🇴','🇴🇲','🇵🇰','🇵🇦','🇵🇾','🇵🇪','🇵🇭','🇵🇹','🇵🇷','🇶🇦','🇷🇴','🇷🇺','🇷🇼','🇸🇲','🇸🇦','🇸🇳','🇷🇸','🇸🇱','🇸🇰','🇸🇮','🇸🇴','🇿🇦','🇪🇸','🇱🇰','🇸🇩','🇸🇷','🇸🇿','🇸🇪','🇨🇭','🇸🇾','🇹🇯','🇹🇿','🇹🇭','🇹🇬','🇹🇴','🇹🇹','🇹🇳','🇹🇷','🇹🇲','🇻🇮','🇺🇬','🇺🇦','🇺🇾','🇺🇿','🇻🇪','🇻🇳','🇾🇪','🇿🇲','🇿🇼','🇦🇩','🇷🇪','🇵🇱','🇬🇺','🇻🇦','🇱🇮','🇨🇼','🇸🇨','🇦🇶','🇬🇮','🇨🇺','🇫🇴','🇦🇽','🇧🇲','🇹🇱'];
// prettier-ignore
const EN = ['HK','MO','TW','JP','KR','SG','US','GB','FR','DE','AU','AE','AF','AL','DZ','AO','AR','AM','AT','AZ','BH','BD','BY','BE','BZ','BJ','BT','BO','BA','BW','BR','VG','BN','BG','BF','BI','KH','CM','CA','CV','KY','CF','TD','CL','CO','KM','CG','CD','CR','HR','CY','CZ','DK','DJ','DO','EC','EG','SV','GQ','ER','EE','ET','FJ','FI','GA','GM','GE','GH','GR','GL','GT','GN','GY','HT','HN','HU','IS','IN','ID','IR','IQ','IE','IM','IL','IT','CI','JM','JO','KZ','KE','KW','KG','LA','LV','LB','LS','LR','LY','LT','LU','MK','MG','MW','MY','MV','ML','MT','MR','MU','MX','MD','MC','MN','ME','MA','MZ','MM','NA','NP','NL','NZ','NI','NE','NG','KP','NO','OM','PK','PA','PY','PE','PH','PT','PR','QA','RO','RU','RW','SM','SA','SN','RS','SL','SK','SI','SO','ZA','ES','LK','SD','SR','SZ','SE','CH','SY','TJ','TZ','TH','TG','TO','TT','TN','TR','TM','VI','UG','UA','UY','UZ','VE','VN','YE','ZM','ZW','AD','RE','PL','GU','VA','LI','CW','SC','AQ','GI','CU','FO','AX','BM','TL'];
// prettier-ignore
const ZH = ['香港','澳门','台湾','日本','韩国','新加坡','美国','英国','法国','德国','澳大利亚','阿联酋','阿富汗','阿尔巴尼亚','阿尔及利亚','安哥拉','阿根廷','亚美尼亚','奥地利','阿塞拜疆','巴林','孟加拉国','白俄罗斯','比利时','伯利兹','贝宁','不丹','玻利维亚','波斯尼亚和黑塞哥维那','博茨瓦纳','巴西','英属维京群岛','文莱','保加利亚','布基纳法索','布隆迪','柬埔寨','喀麦隆','加拿大','佛得角','开曼群岛','中非共和国','乍得','智利','哥伦比亚','科摩罗','刚果(布)','刚果(金)','哥斯达黎加','克罗地亚','塞浦路斯','捷克','丹麦','吉布提','多米尼加共和国','厄瓜多尔','埃及','萨尔瓦多','赤道几内亚','厄立特里亚','爱沙尼亚','埃塞俄比亚','斐济','芬兰','加蓬','冈比亚','格鲁吉亚','加纳','希腊','格陵兰','危地马拉','几内亚','圭亚那','海地','洪都拉斯','匈牙利','冰岛','印度','印尼','伊朗','伊拉克','爱尔兰','马恩岛','以色列','意大利','科特迪瓦','牙买加','约旦','哈萨克斯坦','肯尼亚','科威特','吉尔吉斯斯坦','老挝','拉脱维亚','黎巴嫩','莱索托','利比里亚','利比亚','立陶宛','卢森堡','马其顿','马达加斯加','马拉维','马来','马尔代夫','马里','马耳他','毛利塔尼亚','毛里求斯','墨西哥','摩尔多瓦','摩纳哥','蒙古','黑山共和国','摩洛哥','莫桑比克','缅甸','纳米比亚','尼泊尔','荷兰','新西兰','尼加拉瓜','尼日尔','尼日利亚','朝鲜','挪威','阿曼','巴基斯坦','巴拿马','巴拉圭','秘鲁','菲律宾','葡萄牙','波多黎各','卡塔尔','罗马尼亚','俄罗斯','卢旺达','圣马力诺','沙特阿拉伯','塞内加尔','塞尔维亚','塞拉利昂','斯洛伐克','斯洛文尼亚','索马里','南非','西班牙','斯里兰卡','苏丹','苏里南','斯威士兰','瑞典','瑞士','叙利亚','塔吉克斯坦','坦桑尼亚','泰国','多哥','汤加','特立尼达和多巴哥','突尼斯','土耳其','土库曼斯坦','美属维尔京群岛','乌干达','乌克兰','乌拉圭','乌兹别克斯坦','委内瑞拉','越南','也门','赞比亚','津巴布韦','安道尔','留尼汪','波兰','关岛','梵蒂冈','列支敦士登','库拉索','塞舌尔','南极','直布罗陀','古巴','法罗群岛','奥兰群岛','百慕达','东帝汶'];
// prettier-ignore
const QC = ['Hong Kong','Macao','Taiwan','Japan','Korea','Singapore','United States','United Kingdom','France','Germany','Australia','Dubai','Afghanistan','Albania','Algeria','Angola','Argentina','Armenia','Austria','Azerbaijan','Bahrain','Bangladesh','Belarus','Belgium','Belize','Benin','Bhutan','Bolivia','Bosnia and Herzegovina','Botswana','Brazil','British Virgin Islands','Brunei','Bulgaria','Burkina-faso','Burundi','Cambodia','Cameroon','Canada','CapeVerde','CaymanIslands','Central African Republic','Chad','Chile','Colombia','Comoros','Congo-Brazzaville','Congo-Kinshasa','CostaRica','Croatia','Cyprus','Czech Republic','Denmark','Djibouti','Dominican Republic','Ecuador','Egypt','EISalvador','Equatorial Guinea','Eritrea','Estonia','Ethiopia','Fiji','Finland','Gabon','Gambia','Georgia','Ghana','Greece','Greenland','Guatemala','Guinea','Guyana','Haiti','Honduras','Hungary','Iceland','India','Indonesia','Iran','Iraq','Ireland','Isle of Man','Israel','Italy','Ivory Coast','Jamaica','Jordan','Kazakstan','Kenya','Kuwait','Kyrgyzstan','Laos','Latvia','Lebanon','Lesotho','Liberia','Libya','Lithuania','Luxembourg','Macedonia','Madagascar','Malawi','Malaysia','Maldives','Mali','Malta','Mauritania','Mauritius','Mexico','Moldova','Monaco','Mongolia','Montenegro','Morocco','Mozambique','Myanmar(Burma)','Namibia','Nepal','Netherlands','New Zealand','Nicaragua','Niger','Nigeria','NorthKorea','Norway','Oman','Pakistan','Panama','Paraguay','Peru','Philippines','Portugal','PuertoRico','Qatar','Romania','Russia','Rwanda','SanMarino','SaudiArabia','Senegal','Serbia','SierraLeone','Slovakia','Slovenia','Somalia','SouthAfrica','Spain','SriLanka','Sudan','Suriname','Swaziland','Sweden','Switzerland','Syria','Tajikstan','Tanzania','Thailand','Togo','Tonga','TrinidadandTobago','Tunisia','Turkey','Turkmenistan','U.S.Virgin Islands','Uganda','Ukraine','Uruguay','Uzbekistan','Venezuela','Vietnam','Yemen','Zambia','Zimbabwe','Andorra','Reunion','Poland','Guam','Vatican','Liechtensteins','Curacao','Seychelles','Antarctica','Gibraltar','Cuba','Faroe Islands','Ahvenanmaa','Bermuda','Timor-Leste'];

// ─────────────────────────────────────────────────────────────────────────────
// 正则 / 关键词常量
// ─────────────────────────────────────────────────────────────────────────────
const specialRegex = [
  /(\d\.)?\d+×/,
  /IPLC|IEPL|Kern|Edge|Pro|Std|Exp|Biz|Fam|Game|Buy|Zx|LB/,
];
const nameclear =
  /(套餐|到期|有效|剩余|版本|已用|过期|失联|测试|官方|网址|备用|群|TEST|客服|网站|获取|订阅|流量|机场|下次|官址|联系|邮箱|工单|学术|USE|USED|TOTAL|EXPIRE|EMAIL)/i;
// prettier-ignore
const regexArray = [/ˣ²/,/ˣ³/,/ˣ⁴/,/ˣ⁵/,/ˣ⁶/,/ˣ⁷/,/ˣ⁸/,/ˣ⁹/,/ˣ¹⁰/,/ˣ²⁰/,/ˣ³⁰/,/ˣ⁴⁰/,/ˣ⁵⁰/,/IPLC/i,/IEPL/i,/核心/,/边缘/,/高级/,/标准/,/实验/,/商宽/,/家宽/,/游戏|game/i,/购物/,/专线/,/LB/,/cloudflare/i,/\budp\b/i,/\bgpt\b/i,/udpn\b/];
// prettier-ignore
const valueArray = ["2×","3×","4×","5×","6×","7×","8×","9×","10×","20×","30×","40×","50×","IPLC","IEPL","Kern","Edge","Pro","Std","Exp","Biz","Fam","Game","Buy","Zx","LB","CF","UDP","GPT","UDPN"];
const nameblnx = /(高倍|(?!1)2+(x|倍)|ˣ²|ˣ³|ˣ⁴|ˣ⁵|ˣ¹⁰)/i;
const namenx   = /(高倍|(?!1)(0\.|\d)+(x|倍)|ˣ²|ˣ³|ˣ⁴|ˣ⁵|ˣ¹⁰)/i;
const keya =
  /港|Hong|HK|新加坡|SG|Singapore|日本|Japan|JP|美国|United States|US|韩|土耳其|TR|Turkey|Korea|KR|🇸🇬|🇭🇰|🇯🇵|🇺🇸|🇰🇷|🇹🇷/i;
const keyb =
  /(((1|2|3|4)\d)|(香港|Hong|HK) 0[5-9]|((新加坡|SG|Singapore|日本|Japan|JP|美国|United States|US|韩|土耳其|TR|Turkey|Korea|KR) 0[3-9]))/i;

const rurekey = {
  GB: /UK/g,
  "B-G-P": /BGP/g,
  "Russia Moscow": /Moscow/g,
  "Korea Chuncheon": /Chuncheon|Seoul/g,
  "Hong Kong": /Hongkong|HONG KONG/gi,
  "United Kingdom London": /London|Great Britain/g,
  "Dubai United Arab Emirates": /United Arab Emirates/g,
  "Taiwan TW 台湾 🇹🇼": /(台|Tai\s?wan|TW).*?🇨🇳|🇨🇳.*?(台|Tai\s?wan|TW)/g,
  "United States": /USA|Los Angeles|San Jose|Silicon Valley|Michigan/g,
  澳大利亚: /澳洲|墨尔本|悉尼|土澳|(深|沪|呼|京|广|杭)澳/g,
  德国: /(深|沪|呼|京|广|杭)德(?!.*(I|线))|法兰克福|滬德/g,
  香港: /(深|沪|呼|京|广|杭)港(?!.*(I|线))/g,
  日本: /(深|沪|呼|京|广|杭|中|辽)日(?!.*(I|线))|东京|大坂/g,
  新加坡: /狮城|(深|沪|呼|京|广|杭)新/g,
  美国: /(深|沪|呼|京|广|杭)美|波特兰|芝加哥|哥伦布|纽约|硅谷|俄勒冈|西雅图/g,
  波斯尼亚和黑塞哥维那: /波黑共和国/g,
  印尼: /印度尼西亚|雅加达/g,
  印度: /孟买/g,
  阿联酋: /迪拜|阿拉伯联合酋长国/g,
  孟加拉国: /孟加拉/g,
  捷克: /捷克共和国/g,
  台湾: /新台|新北|台(?!.*线)/g,
  Taiwan: /Taipei/g,
  韩国: /春川|韩|首尔/g,
  Japan: /Tokyo|Osaka/g,
  英国: /伦敦/g,
  India: /Mumbai/g,
  Germany: /Frankfurt/g,
  Switzerland: /Zurich/g,
  俄罗斯: /莫斯科/g,
  土耳其: /伊斯坦布尔/g,
  泰国: /泰國|曼谷/g,
  法国: /巴黎/g,
  G: /\d\s?GB/gi,
  Esnc: /esnc/gi,
};

// ─────────────────────────────────────────────────────────────────────────────
// Allmap 缓存（仅初始化一次）
// ─────────────────────────────────────────────────────────────────────────────
let _mapReady = false;
let _AMK = [];

function _ensureMap(Allmap) {
  if (!_mapReady) {
    _mapReady = true;
    _AMK = Object.entries(Allmap);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────────────────────────────────────────
function getList(arg) {
  switch (arg) {
    case "us":   return EN;
    case "gq":   return FG;
    case "quan": return QC;
    default:     return ZH;
  }
}

/** 对同名节点追加 01、02… 序号 */
function jxh(arr) {
  const grouped = arr.reduce((acc, node) => {
    const found = acc.find((g) => g.name === node.name);
    if (found) {
      found.count++;
      found.items.push({
        ...node,
        name: `${node.name}${XHFGF}${found.count.toString().padStart(2, "0")}`,
      });
    } else {
      acc.push({ name: node.name, count: 1, items: [{ ...node, name: `${node.name}${XHFGF}01` }] });
    }
    return acc;
  }, []);
  const flat =
    typeof Array.prototype.flatMap === "function"
      ? grouped.flatMap((g) => g.items)
      : grouped.reduce((acc, g) => acc.concat(g.items), []);
  arr.splice(0, arr.length, ...flat);
  return arr;
}

/** 仅有一个节点的地区去掉末尾 01 */
function oneP(arr) {
  const map = arr.reduce((acc, node) => {
    const base = node.name.replace(/[^A-Za-z0-9\u00C0-\u017F\u4E00-\u9FFF]+\d+$/, "");
    if (!acc[base]) acc[base] = [];
    acc[base].push(node);
    return acc;
  }, {});
  for (const base in map) {
    if (map[base].length === 1 && map[base][0].name.endsWith("01")) {
      map[base][0].name = map[base][0].name.replace(/[^.]01$/, "");
    }
  }
  return arr;
}

/** 将带特殊标识（倍率/IPLC 等）的节点移至末尾并排序 */
function fampx(pro) {
  const special = [], normal = [];
  for (const p of pro) {
    specialRegex.some((r) => r.test(p.name)) ? special.push(p) : normal.push(p);
  }
  const idx = special.map((p) => specialRegex.findIndex((r) => r.test(p.name)));
  special.sort(
    (a, b) => idx[special.indexOf(a)] - idx[special.indexOf(b)] || a.name.localeCompare(b.name)
  );
  normal.sort((a, b) => pro.indexOf(a) - pro.indexOf(b));
  return normal.concat(special);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1：地区重命名
// ─────────────────────────────────────────────────────────────────────────────
function keywosRename(pro) {
  const Allmap  = {};
  const outList = getList(outputName);
  const inputList = inname !== "" ? [getList(inname)] : [ZH, FG, QC, EN];

  inputList.forEach((arr) => {
    arr.forEach((val, idx) => { Allmap[val] = outList[idx]; });
  });

  // 节点过滤
  if (clear || nx || blnx || key) {
    pro = pro.filter((node) => {
      const name = node.name;
      return (
        !(clear && nameclear.test(name)) &&
        !(nx    && namenx.test(name))    &&
        !(blnx  && !nameblnx.test(name)) &&
        !(key   && !(keya.test(name) && /2|4|6|7/i.test(name)))
      );
    });
  }

  const BLKEYS = BLKEY ? BLKEY.split("+") : [];

  pro.forEach((e) => {
    let hitRure = false;
    let retainKey = "";
    const origName = e.name;

    // 预处理别名替换
    Object.keys(rurekey).forEach((rKey) => {
      if (rurekey[rKey].test(e.name)) {
        e.name = e.name.replace(rurekey[rKey], rKey);

        if (BLKEYS.length) {
          hitRure = true;
          let replaceVal = "", doReplace = false;
          BLKEYS.forEach((token) => {
            if (token.includes(">") && origName.includes(token.split(">")[0])) {
              if (rurekey[rKey].test(token.split(">")[0])) {
                e.name += " " + token.split(">")[0];
              }
              if (token.split(">")[1]) { replaceVal = token.split(">")[1]; doReplace = true; }
            } else {
              if (origName.includes(token)) e.name += " " + token;
            }
          });
          retainKey = doReplace ? replaceVal : BLKEYS.filter((t) => e.name.includes(t));
        }
      }
    });

    // blockquic 字段
    if      (blockquic === "on")  e["block-quic"] = "on";
    else if (blockquic === "off") e["block-quic"] = "off";
    else                          delete e["block-quic"];

    // 未命中预处理时的自定义关键词保留
    if (!hitRure && BLKEYS.length) {
      let replaceVal = "", doReplace = false;
      BLKEYS.forEach((token) => {
        if (token.includes(">") && e.name.includes(token.split(">")[0])) {
          if (token.split(">")[1]) { replaceVal = token.split(">")[1]; doReplace = true; }
        }
      });
      retainKey = doReplace ? replaceVal : BLKEYS.filter((t) => e.name.includes(t));
    }

    // 固定格式标识（blgd）
    let ikeys = "";
    if (blgd) {
      regexArray.forEach((regex, i) => { if (regex.test(e.name)) ikeys = valueArray[i]; });
    }

    // 正则匹配倍率（bl）
    let ikey = "";
    if (bl) {
      const m = e.name.match(
        /((倍率|X|x|×)\D?((\d{1,3}\.)?\d+)\D?)|((\d{1,3}\.)?\d+)(倍|X|x|×)/
      );
      if (m) {
        const rev = m[0].match(/(\d[\d.]*)/)[0];
        if (rev !== "1") ikey = rev + "×";
      }
    }

    // 地区匹配
    _ensureMap(Allmap);
    const found = _AMK.find(([k]) => e.name.includes(k));

    let firstName = "", nNames = "";
    if (nf) firstName = FNAME;
    else    nNames    = FNAME;

    if (found?.[1]) {
      const regionName = found[1];
      let usflag = "";
      if (addflag) {
        const fi = outList.indexOf(regionName);
        if (fi !== -1) {
          usflag = FG[fi];
          usflag = usflag === "🇹🇼" ? "🇨🇳" : usflag;
        }
      }
      const parts = [firstName, usflag, nNames, regionName, retainKey, ikey, ikeys].filter(
        (v) => v !== "" && v.length > 0
      );
      e.name = parts.join(FGF);
    } else {
      // 未匹配到地区
      if (nm) {
        e.name = FNAME ? FNAME + FGF + e.name : e.name;
      } else {
        e.name = null; // 标记为待删除
      }
    }
  });

  // 移除未匹配节点
  pro = pro.filter((e) => e.name !== null);

  // 序号 / 单节点处理 / 特殊排序
  jxh(pro);
  if (numone) oneP(pro);
  if (blpx)   pro = fampx(pro);
  if (key)    pro = pro.filter((e) => !keyb.test(e.name));

  return pro;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2：协议类型前缀
// ─────────────────────────────────────────────────────────────────────────────
function addProtoPrefix(proxies) {
  proxies.forEach((p) => {
    const t = String(p.type || "").toLowerCase();
    if (PROTO_ONLY && !PROTO_ONLY.includes(t)) return;
    const label = PROTO_LABEL[t];
    if (!label) return;
    const tag    = USE_BRACKETS ? "[" + label + "]" : label;
    const prefix = tag + PROTO_SEP;
    // 幂等：已包含相同标签则跳过，避免重复叠加
    if (!p.name.startsWith(tag)) {
      p.name = prefix + p.name;
    }
  });
  return proxies;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-Store 入口
// ─────────────────────────────────────────────────────────────────────────────
function operator(proxies, targetPlatform, context) {
  // ① 地区重命名（检测到 in/out/nm/flag/bl 等任意改名参数才执行，否则原名保留）
  if (RENAME_ENABLED) {
    proxies = keywosRename(proxies);
  }

  // ② 协议类型前缀（proto=off 时跳过）
  if (PROTO_ENABLED) {
    proxies = addProtoPrefix(proxies);
  }

  return proxies;
}
