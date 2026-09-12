/**
 * AgentRouter 自动签到 for Loon
 * v4.0.0 · 2026-09-12
 * 插件通过 argument=[{account}, ...] 传入参数。
 */

var VERSION = "v4.0.0 (2026-09-12)";
var LOGIN_PATH = "/api/user/login";
var SELF_PATH = "/api/user/self";
var LOG_PATH = "/api/log/self/";
var QUOTA_PER_DOLLAR = 500000;
var UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
var finished = false;

function finish(value) {
  if (finished) return;
  finished = true;
  // Loon 的 Cron 脚本无响应对象时必须无参数调用；$done(undefined)
  // 在部分版本中会被当作响应对象并读取 body，从而触发 e.body 报错。
  if (value === undefined) $done();
  else $done(value);
}
function pad2(n) { return String(n).padStart(2, "0"); }
function nowStamp() {
  var d = new Date();
  return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate())+" "+pad2(d.getHours())+":"+pad2(d.getMinutes());
}
function todayKey() {
  var d = new Date();
  return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate());
}
function errMsg(e) {
  if (!e) return "未知错误";
  return String(e.message || e.error || e);
}
function toDollar(q) {
  var n = Number(q);
  return isFinite(n) ? Math.round(n / QUOTA_PER_DOLLAR * 100) / 100 : null;
}
function money(v) { return v === null || !isFinite(Number(v)) ? "未知" : "$"+Number(v).toFixed(2); }
function bool(v, def) {
  if (v === undefined || v === null || v === "") return def;
  return v === true || String(v).toLowerCase() === "true";
}
function args() {
  var a = typeof $argument === "undefined" || !$argument ? {} : $argument;
  if (typeof a !== "object") a = {account:String(a)};
  return {
    accounts: String(a.account || ""),
    baseUrl: String(a.baseUrl || "https://agentrouter.org").replace(/\/+$/, ""),
    timeout: Math.max(1, Number(a.requestTimeout || 20)) * 1000,
    verify: bool(a.verify, true),
    notify: String(a.notify || "always").toLowerCase(),
    showCookie: bool(a.showCookie, false)
  };
}
function parseAccounts(raw) {
  var out=[];
  // 每行一个账号，使用账号后的第一段空白字符分隔密码。
  // 只切分第一段空白，因此密码可原样包含 #、| 以及后续空格。
  String(raw||"").split(/\r?\n|\r/).forEach(function(item, i) {
    item=item.trim();
    if(!item) return;
    var match=item.match(/^(\S+)\s+([\s\S]+)$/);
    if(!match) return;
    var account=match[1].trim(), password=match[2], name="";
    var first=account.indexOf("@"), last=account.lastIndexOf("@");
    if(first>0 && last>first) { name=account.slice(0,first).trim(); account=account.slice(first+1).trim(); }
    if(account && password) out.push({name:name||account||("账号"+(i+1)),username:account,password:password});
  });
  return out;
}
function header(headers, key) {
  if (!headers) return "";
  var wanted=key.toLowerCase(), value="";
  Object.keys(headers).some(function(k){ if(k.toLowerCase()===wanted){value=headers[k];return true;} return false; });
  return value;
}
function pickCookie(headers) {
  var raw=header(headers,"set-cookie"), jar={};
  (Array.isArray(raw)?raw:[raw]).filter(Boolean).forEach(function(line){
    String(line).split(/,(?=[^;,=]+=[^;]*)/).forEach(function(piece){
      var kv=piece.split(";")[0].trim(), p=kv.indexOf("=");
      if(p>0) jar[kv.slice(0,p).trim()]=kv.slice(p+1).trim();
    });
  });
  return Object.keys(jar).map(function(k){return k+"="+jar[k];}).join("; ");
}
function readJson(response, data, label) {
  var text=typeof data === "string" ? data : String(data||"");
  var ct=String(header(response&&response.headers,"content-type")||"").toLowerCase();
  if(ct.indexOf("text/html")>=0 || /^\s*</.test(text)) throw new Error(label+" 返回 HTML（HTTP "+(response&&response.status)+"）");
  try { return JSON.parse(text); } catch(e) { throw new Error(label+" 返回非 JSON（HTTP "+(response&&response.status)+"): "+text.slice(0,80)); }
}
function request(method, options, label) {
  console.log("→ ["+label+"] "+method.toUpperCase()+" "+options.url);
  return new Promise(function(resolve,reject){
    $httpClient[method](options,function(error,response,data){
      if(error) {
        console.log("✗ ["+label+"] 请求失败: "+error);
        return reject(new Error(label+"请求失败: "+error));
      }
      console.log("← ["+label+"] HTTP "+(response&&response.status)+"，响应 "+(typeof data==="string"?data.length:(data&&data.length||0))+" 字节");
      try {
        var json=readJson(response,data,label);
        console.log("  ↳ ["+label+"] success="+json.success+(json.message?"，message="+json.message:""));
        resolve({response:response,data:data,json:json});
      } catch(e) {
        console.log("✗ ["+label+"] "+errMsg(e));
        reject(e);
      }
    });
  });
}
function commonOptions(cfg, url, headers) {
  // 不指定 node：请求按分流规则处理，命中插件 [Rule] 的
  // {mainPolicy}/{backupPolicy} 参数所选策略（PROXY 映射或 DIRECT）
  return {url:url,headers:headers,timeout:cfg.timeout,"auto-redirect":true,"auto-cookie":true};
}
async function login(cfg, acc) {
  console.log("—— 账号「"+acc.name+"」开始登录 ——");
  console.log("  用户名: "+acc.username+"，密码长度: "+acc.password.length);
  var h={"User-Agent":UA,"Content-Type":"application/json",Accept:"application/json, text/plain, */*",Origin:cfg.baseUrl,Referer:cfg.baseUrl+"/login","Cache-Control":"no-store"};
  var o=commonOptions(cfg,cfg.baseUrl+LOGIN_PATH,h);
  o.body=JSON.stringify({username:acc.username,password:acc.password});
  var x=await request("post",o,"登录接口");
  if(!x.json.success) throw new Error(String(x.json.message||"登录失败").replace(/[\r\n]+/g," "));
  var cookie=pickCookie(x.response.headers);
  console.log("  登录成功，用户ID: "+(x.json.data&&x.json.data.id||"未知")+"，checked_in: "+(x.json.data&&x.json.data.checked_in));
  console.log("  获取 Cookie: "+(cookie?cookie.slice(0,60)+(cookie.length>60?"…":""):"无"));
  return {data:x.json.data||{},cookie:cookie};
}
async function fetchQuota(cfg,cookie,userId,fallback) {
  var out={remaining:toDollar(fallback&&fallback.quota),used:toDollar(fallback&&fallback.used_quota)};
  console.log("  查询额度（来源: 登录响应回退值 → 剩余 "+money(out.remaining)+"，已用 "+money(out.used)+"）");
  try {
    var h={"User-Agent":UA,Accept:"application/json","Cache-Control":"no-store"};
    if(cookie) h.Cookie=cookie; if(userId) h["New-API-User"]=String(userId);
    var x=await request("get",commonOptions(cfg,cfg.baseUrl+SELF_PATH,h),"用户信息接口");
    if(x.json.success&&x.json.data){
      out.remaining=toDollar(x.json.data.quota);out.used=toDollar(x.json.data.used_quota);
      console.log("  额度已更新（来源: /api/user/self → 剩余 "+money(out.remaining)+"，已用 "+money(out.used)+"）");
    } else { console.log("  /api/user/self 响应 success=false，沿用登录响应的额度"); }
  } catch(e) { console.log("  额度查询失败，使用登录响应: "+errMsg(e)); }
  return out;
}
async function verifyLog(cfg,cookie,userId) {
  if(!cookie) { console.log("  跳过日志核验：无 Cookie"); return {ok:false,detail:"无 Cookie，跳过核验"}; }
  try {
    var start=Math.floor(new Date(todayKey()+"T00:00:00").getTime()/1000);
    var url=cfg.baseUrl+LOG_PATH+"?p=1&page_size=20&type=4&start_timestamp="+start+"&end_timestamp="+Math.floor(Date.now()/1000);
    var h={"User-Agent":UA,Accept:"application/json","Cache-Control":"no-store",Cookie:cookie};
    if(userId) h["New-API-User"]=String(userId);
    console.log("  核验签到日志（type=4，起始时间戳 "+start+"）");
    var x=await request("get",commonOptions(cfg,url,h),"日志接口");
    var items=(x.json.data&&(x.json.data.items||x.json.data))||[];
    var list=Array.isArray(items)?items:[];
    console.log("  日志条数: "+list.length);
    var hit=list.find(function(it){return Number(it.created_at||it.timestamp||0)>=start;});
    if(hit) {
      var detail="今日签到日志已确认"+(toDollar(hit.quota)!==null?"，+"+money(toDollar(hit.quota)):"");
      console.log("  ✅ "+detail);
      return {ok:true,detail:detail};
    }
    console.log("  ⚠️ 未查到今日签到日志");
    return {ok:false,detail:"未查到今日签到日志"};
  } catch(e) { console.log("  日志核验失败: "+errMsg(e)); return {ok:false,detail:"日志核验失败: "+errMsg(e)}; }
}
async function runAccount(cfg,acc) {
  console.log("===== 开始处理账号 "+acc.name+" =====");
  var r={name:acc.name,status:"fail",message:"",quota:null,used:null,cookie:""};
  try {
    var x=await login(cfg,acc), data=x.data;
    r.cookie=x.cookie; r.name=data.username||data.display_name||acc.name;
    var q=await fetchQuota(cfg,x.cookie,data.id,data); r.quota=q.remaining; r.used=q.used;
    if(Boolean(data.checked_in)) {
      r.status="success"; r.message="签到成功，额度已到账";
      if(cfg.verify){var v=await verifyLog(cfg,x.cookie,data.id);r.message+="（"+v.detail+"）";}
    } else { r.status="already"; r.message="今日已签到，无需重复操作"; }
    if(x.cookie) {
      var saved=$persistentStore.write(JSON.stringify({cookie:x.cookie,userId:data.id,date:todayKey(),updatedAt:nowStamp()}),"agentrouter_cookie_"+acc.username);
      console.log("  Cookie 已持久化保存: "+(saved?"成功":"失败"));
    }
    console.log("===== 账号 "+r.name+" 完成: "+r.message+" =====");
  } catch(e) { r.message=errMsg(e); console.log("✗ 账号 "+acc.name+" 执行失败: "+r.message); }
  return r;
}
async function main() {
  console.log("AgentRouter 签到脚本启动 "+VERSION);
  console.log("运行环境: "+(typeof $loon!=="undefined"?$loon:"未知"));
  console.log("脚本: "+(typeof $script!=="undefined"&&$script.name?$script.name:"AgentRouter"));
  console.log("执行时间: "+nowStamp());
  var cfg=args(), accounts=parseAccounts(cfg.accounts);
  // 代理路由：请求不指定 node，按分流规则匹配插件 [Rule] 的
  // 「主站策略」「备用站策略」参数（PROXY 映射 / DIRECT）
  console.log("配置 → 站点: "+cfg.baseUrl+"，代理: 按插件规则（主站/备用站策略参数），超时: "+(cfg.timeout/1000)+"s，核验: "+cfg.verify+"，通知: "+cfg.notify);
  console.log("解析到 "+accounts.length+" 个账号: "+(accounts.length?accounts.map(function(a){return a.name;}).join("、"):"无"));
  if(!accounts.length){
    console.log("✗ 未解析到任何账号，请检查插件参数格式（每行：账号 空格 密码）");
    $notification.post("AgentRouter 签到","配置缺失","请打开插件参数填写账号，每行一个：账号 空格 密码。\n"+VERSION);
    return finish();
  }
  var results=[];
  for(var i=0;i<accounts.length;i++) {
    console.log("—— 进度: 账号 "+(i+1)+"/"+accounts.length+" ——");
    results.push(await runAccount(cfg,accounts[i]));
  }
  var icon={success:"✅",already:"🟡",fail:"❌"};
  var lines=results.map(function(r){
    var s=icon[r.status]+" "+r.name+"\n"+r.message;
    if(r.quota!==null||r.used!==null)s+="\n剩余 "+money(r.quota)+"｜已用 "+money(r.used);
    if(cfg.showCookie&&r.cookie)s+="\nCookie: "+r.cookie;
    return s;
  });
  var ok=results.filter(function(r){return r.status==="success";}).length;
  var already=results.filter(function(r){return r.status==="already";}).length;
  var fail=results.filter(function(r){return r.status==="fail";}).length;
  console.log("===== 汇总: 成功 "+ok+"，已签 "+already+"，失败 "+fail+" =====");
  var should=cfg.notify==="always"||(cfg.notify==="fail"&&fail>0)||(cfg.notify==="change"&&(ok>0||fail>0));
  if(!should) console.log("按通知策略（"+cfg.notify+"）本次不发送通知");
  if(should)$notification.post("AgentRouter 签到","成功 "+ok+"｜已签 "+already+"｜失败 "+fail,lines.join("\n\n")+"\n\n🕐 "+nowStamp()+"　"+VERSION,{openUrl:cfg.baseUrl});
  console.log("AgentRouter 签到脚本结束");
  finish();
}
main().catch(function(e){console.log("AgentRouter: "+errMsg(e));$notification.post("AgentRouter 签到","脚本异常",errMsg(e));finish();});
