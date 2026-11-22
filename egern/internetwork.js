/**
 * Egern「网络诊断雷达」
 *
 * 环境变量：
 * - POLICY：最高优先级。指定后，出口、延迟、UDP/QUIC、流媒体、AI 全部统一走 POLICY
 * - LMT：流媒体检测策略组。POLICY 为空时生效
 * - AI：AI 检测策略组。POLICY 为空时生效
 * - YS=1：显示 IP 的地方启用隐私打码，例如 123.123.123.123 -> 123.123.*.*
 * - YS=0 或不设置：不打码
 * - XY：手动指定协议，例如 VLESS / Trojan / HY2 / AnyTLS
 * - XY 未设置：继续按原逻辑从 Egern 上下文 / 节点元数据 / 节点名尝试识别
 * - LOCAL：mainland（默认，本地出口固定显示中国大陆）/ auto（按直连出口实际定位）
 * - REFRESH：刷新间隔（分钟），默认 15，范围 5-240
 *
 * 策略优先级：
 * POLICY ＞ LMT / AI ＞ 单服务内置候选策略名匹配 ＞ 不指定 policy
 *
 * 单服务匹配逻辑：
 * - POLICY 为空，LMT/AI 也为空时，每个服务单独使用自己的候选策略名表
 * - 每个服务在本轮刷新中只匹配一次
 * - 匹配成功后缓存本轮结果
 * - 匹配不到时该服务不传 policy，走 Widget 默认请求方式
 * - 服务小国旗来自该服务实际使用策略的出口地区，不再复用顶部当前代理出口
 */

export default async function (ctx) {
  const env = ctx.env || {};
  const glass = styleMode(env) === "glass";
  const C = palette(glass);
  const SCHEME = detectScheme(ctx);

  const POLICY = clean(env.POLICY);
  const POLICY_LABEL = POLICY || "默认规则";
  const LMT_POLICY = clean(env.LMT);
  const AI_POLICY = clean(env.AI);
  const MASK_IP = clean(env.YS) === "1";
  const FORCE_PROTOCOL = clean(env.XY);

  const TIMEOUT = 4500;
  const POLICY_PROBE_TIMEOUT = 1500;
  const POLICY_PROBE_BATCH_SIZE = 10;
  const POLICY_RESOLVE_BUDGET = 6000;
  const TASK_DEADLINE = 12000;
  const POLICY_CACHE_TTL_HIT = 6 * 3600 * 1000;
  const POLICY_CACHE_TTL_MISS = 3600 * 1000;
  const REFRESH_MINUTES = clean(env.REFRESH)
    ? numberInRange(env.REFRESH, 5, 240, 15)
    : 15;
  const FORCE_LOCAL_MAINLAND = clean(env.LOCAL).toLowerCase() !== "auto";

  const servicePolicyCache = {};
  const policyProbeCache = {};
  const policyExitCache = {};

  const SCREEN_W = numberInRange(
    pick(getScreenMetric(ctx, "width"), 440),
    320,
    900,
    440
  );

  const SCREEN_H = numberInRange(
    pick(getScreenMetric(ctx, "height"), 956),
    568,
    1400,
    956
  );

  const WIDTH_SCALE = SCREEN_W / 440;
  const HEIGHT_SCALE = SCREEN_H / 956;
  const UI_SCALE = clamp(WIDTH_SCALE * 0.88 + HEIGHT_SCALE * 0.12, 0.9, 1.06);
  const FONT_SCALE = clamp(UI_SCALE, 0.9, 1.045);

  const CURRENT_PROXY = getCurrentProxyInfo(ctx);
  const NODE_PROTOCOL =
    protocolFromXY(FORCE_PROTOCOL) ||
    CURRENT_PROXY.protocol ||
    "未暴露";

  const MAINLAND_LATENCY_URLS = [
    "http://connect.rom.miui.com/generate_204",
    "http://wifi.vivo.com.cn/generate_204",
    "https://www.baidu.com/favicon.ico",
    "https://www.qq.com/favicon.ico",
    "https://www.aliyun.com/favicon.ico"
  ];

  const GLOBAL_PROXY_LATENCY_URLS = [
    "https://cp.cloudflare.com/generate_204",
    "https://www.gstatic.com/generate_204",
    "https://www.google.com/generate_204",
    "https://www.cloudflare.com/favicon.ico"
  ];

  const POLICY_PROBE_URLS = [
    "https://cp.cloudflare.com/generate_204",
    "https://www.gstatic.com/generate_204",
    "https://www.cloudflare.com/favicon.ico"
  ];

  const QUIC_TRACE_URLS = [
    "https://cloudflare-quic.com/cdn-cgi/trace",
    "https://cloudflare.com/cdn-cgi/trace",
    "https://www.cloudflare.com/cdn-cgi/trace",
    "https://one.one.one.one/cdn-cgi/trace",
    "https://1.1.1.1/cdn-cgi/trace"
  ];

  const MEDIA_SERVICE_IDS = [
    "netflix",
    "disney",
    "spotify",
    "tiktok",
    "youtube",
    "prime"
  ];

  const AI_SERVICE_IDS = [
    "chatgpt",
    "claude",
    "gemini",
    "deepseek",
    "grok",
    "perplexity"
  ];

  const device = ctx.device || {};
  const wifi = device.wifi || {};
  const ipv4 = device.ipv4 || {};
  const ipv6 = device.ipv6 || {};

  const dnsServers = Array.isArray(device.dnsServers)
    ? device.dnsServers.filter(Boolean)
    : [];

  let networkName = getLocalNetworkName(device);

  const localIP =
    clean(
      pick(
        ipv4.address,
        wifi.ip,
        wifi.ipAddress,
        device.ipAddress,
        device.ip
      )
    ) || "未获取";

  const gateway =
    clean(
      pick(
        ipv4.gateway,
        wifi.gateway,
        device.gateway
      )
    ) || "未获取";

  const hasIPv4 = Boolean(clean(localIP)) && localIP !== "未获取";
  const hasIPv6 = Boolean(clean(pick(ipv6.address, device.ipv6Address)));
  const baseDNS = detectDNSProvider(dnsServers);
  const now = new Date();

  function S(value) {
    if (typeof value !== "number") return value;
    return Math.round(value * UI_SCALE * 100) / 100;
  }

  function FS(value) {
    if (typeof value !== "number") return value;
    return Math.round(value * FONT_SCALE * 100) / 100;
  }

  function displayIP(value) {
    return MASK_IP ? maskIP(value) : value;
  }

  function scaleStyle(object) {
    if (!object || typeof object !== "object" || Array.isArray(object)) {
      return object;
    }

    const scaled = {};
    const scaleKeys = {
      width: true,
      height: true,
      gap: true,
      borderRadius: true,
      borderWidth: true,
      length: true
    };

    Object.keys(object).forEach(function (key) {
      const value = object[key];

      if (key === "padding" && Array.isArray(value)) {
        scaled[key] = value.map(function (item) {
          return S(item);
        });
      } else if (scaleKeys[key] && typeof value === "number") {
        scaled[key] = S(value);
      } else {
        scaled[key] = value;
      }
    });

    return scaled;
  }

  function uiColor(value) {
    return resolveAdaptiveColor(value, SCHEME);
  }

  function requestOptions(extra) {
    const options = {
      timeout: TIMEOUT,
      redirect: "follow",
      credentials: "omit",
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        Accept: "application/json,text/plain,text/html,*/*",
        "Cache-Control": "no-cache"
      }
    };

    if (POLICY) {
      options.policy = POLICY;
    }

    return Object.assign(options, extra || {});
  }

  function directRequestOptions(extra) {
    return Object.assign(
      {
        timeout: TIMEOUT,
        redirect: "follow",
        credentials: "omit",
        policy: "DIRECT",
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
          Accept: "application/json,text/plain,text/html,*/*",
          "Cache-Control": "no-cache"
        }
      },
      extra || {}
    );
  }

  function serviceRequestOptions(policy, extra) {
    const options = {
      timeout: TIMEOUT,
      redirect: "follow",
      credentials: "omit",
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,text/plain,*/*;q=0.8",
        "Cache-Control": "no-cache"
      }
    };

    const targetPolicy = clean(policy);

    if (targetPolicy) {
      options.policy = targetPolicy;
    }

    return Object.assign(options, extra || {});
  }

  function policyProbeRequestOptions(policy, extra) {
    const options = {
      timeout: POLICY_PROBE_TIMEOUT,
      redirect: "follow",
      credentials: "omit",
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,text/plain,*/*;q=0.8",
        "Cache-Control": "no-cache"
      }
    };

    const targetPolicy = clean(policy);

    if (targetPolicy) {
      options.policy = targetPolicy;
    }

    return Object.assign(options, extra || {});
  }

  async function readStore(key) {
    try {
      const store = ctx.storage;
      if (!store) return null;

      if (typeof store.getJSON === "function") {
        return (await store.getJSON("radar:" + key)) || null;
      }

      if (typeof store.get === "function") {
        const raw = await store.get("radar:" + key);
        return raw ? JSON.parse(raw) : null;
      }
    } catch (_) {}

    return null;
  }

  async function writeStore(key, value) {
    try {
      const store = ctx.storage;
      if (!store) return;

      if (typeof store.setJSON === "function") {
        await store.setJSON("radar:" + key, value);
      } else if (typeof store.set === "function") {
        await store.set("radar:" + key, JSON.stringify(value));
      }
    } catch (_) {}
  }

  // 超时 / 异常都落到 fallback，保证单个任务不会拖垮整个组件
  function guard(promise, ms, fallback) {
    if (typeof setTimeout !== "function") {
      return Promise.resolve(promise).catch(function () {
        return fallback;
      });
    }

    return new Promise(function (resolve) {
      let done = false;

      const timer = setTimeout(function () {
        if (!done) {
          done = true;
          resolve(fallback);
        }
      }, ms);

      Promise.resolve(promise).then(
        function (value) {
          if (!done) {
            done = true;
            clearTimeout(timer);
            resolve(value);
          }
        },
        function () {
          if (!done) {
            done = true;
            clearTimeout(timer);
            resolve(fallback);
          }
        }
      );
    });
  }

  async function getJSON(url) {
    try {
      const response = await ctx.http.get(url, requestOptions());
      return {
        ok: response.status >= 200 && response.status < 400,
        status: response.status,
        data: await response.json()
      };
    } catch (_) {
      return {
        ok: false,
        status: 0,
        data: null
      };
    }
  }

  async function getJSONDirect(url) {
    try {
      const response = await ctx.http.get(url, directRequestOptions());
      return {
        ok: response.status >= 200 && response.status < 400,
        status: response.status,
        data: await response.json()
      };
    } catch (_) {
      return {
        ok: false,
        status: 0,
        data: null
      };
    }
  }

  async function getText(url) {
    const startedAt = Date.now();

    try {
      const response = await ctx.http.get(url, requestOptions());
      return {
        ok: response.status >= 200 && response.status < 400,
        status: response.status,
        text: (await response.text()) || "",
        ms: Math.max(1, Date.now() - startedAt)
      };
    } catch (_) {
      return {
        ok: false,
        status: 0,
        text: "",
        ms: Math.max(1, Date.now() - startedAt)
      };
    }
  }

  async function getServiceStatus(url, servicePolicy) {
    const startedAt = Date.now();

    try {
      const response = await ctx.http.get(
        url,
        serviceRequestOptions(servicePolicy)
      );

      return {
        ok: serviceState(response.status) === "ok",
        state: serviceState(response.status),
        status: response.status,
        ms: Math.max(1, Date.now() - startedAt)
      };
    } catch (_) {
      return {
        ok: false,
        status: 0,
        ms: Math.max(1, Date.now() - startedAt)
      };
    }
  }

  async function getPolicyExit(policy) {
    const targetPolicy = clean(policy);
    const key = targetPolicy || "__DEFAULT__";

    if (!policyExitCache[key]) {
      policyExitCache[key] = (async function () {
        const urls = [
          "http://ip-api.com/json/?lang=zh-CN&fields=status,message,query,country,countryCode,regionName,city,isp,org,as,asname&_=" + Date.now(),
          "https://ipwho.is/?lang=zh-CN&_=" + Date.now(),
          "https://api.ipapi.is/?_=" + Date.now()
        ];

        for (let index = 0; index < urls.length; index += 1) {
          try {
            const response = await ctx.http.get(
              urls[index],
              serviceRequestOptions(targetPolicy, {
                headers: {
                  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
                  Accept: "application/json,text/plain,*/*",
                  "Cache-Control": "no-cache"
                }
              })
            );

            if (response.status < 200 || response.status >= 400) {
              continue;
            }

            const parsed = parsePolicyExit(await response.json());

            if (parsed && parsed.countryCode) {
              return parsed;
            }
          } catch (_) {}
        }

        return {
          ip: "",
          country: "",
          countryCode: "",
          city: "",
          region: "",
          label: "NET"
        };
      })();
    }

    return await policyExitCache[key];
  }

  function parsePolicyExit(data) {
    if (!data || typeof data !== "object") {
      return {
        ip: "",
        country: "",
        countryCode: "",
        city: "",
        region: "",
        label: "NET"
      };
    }

    const ip = clean(
      pick(
        data.query,
        data.ip,
        data.ip_address,
        getAt(data, "location.ip")
      )
    );

    const rawCountry = clean(
      pick(
        data.country,
        data.country_name,
        getAt(data, "location.country")
      )
    );

    const code = countryCode(
      pick(
        data.countryCode,
        data.country_code,
        getAt(data, "location.country_code"),
        /^[A-Za-z]{2}$/.test(rawCountry) ? rawCountry : ""
      )
    );

    const region = clean(
      pick(
        data.regionName,
        data.region,
        getAt(data, "location.region")
      )
    );

    const city = clean(
      pick(
        data.city,
        getAt(data, "location.city")
      )
    );

    return {
      ip: ip,
      country: rawCountry,
      countryCode: code,
      city: city,
      region: region,
      label: code ? flag(code) + " " + code : "NET"
    };
  }

  async function probePolicy(policy) {
    const name = clean(policy);

    if (!name) {
      return false;
    }

    const key = name;

    if (!policyProbeCache[key]) {
      policyProbeCache[key] = (async function () {
        const urls = POLICY_PROBE_URLS.slice(0, 2).map(function (url) {
          return url + "?_=" + Date.now() + randomAlphaNum(5);
        });

        for (let index = 0; index < urls.length; index += 1) {
          try {
            const response = await ctx.http.get(
              urls[index],
              policyProbeRequestOptions(name)
            );

            if (response.status >= 200 && response.status < 500) {
              return true;
            }
          } catch (_) {}
        }

        return false;
      })();
    }

    return await policyProbeCache[key];
  }

  async function firstWorkingPolicy(candidates) {
    const list = dedupeCandidates(candidates);

    for (let start = 0; start < list.length; start += POLICY_PROBE_BATCH_SIZE) {
      const batch = list.slice(start, start + POLICY_PROBE_BATCH_SIZE);
      const results = await Promise.all(
        batch.map(function (policy) {
          return probePolicy(policy);
        })
      );

      for (let index = 0; index < results.length; index += 1) {
        if (results[index]) {
          return batch[index];
        }
      }
    }

    return "";
  }

  async function resolveServicePolicy(serviceId, category) {
    const id = clean(serviceId).toLowerCase();
    const type = clean(category).toLowerCase();
    const cacheKey = type + ":" + id;

    if (Object.prototype.hasOwnProperty.call(servicePolicyCache, cacheKey)) {
      return servicePolicyCache[cacheKey];
    }

    servicePolicyCache[cacheKey] = (async function () {
      if (POLICY) return POLICY;
      if (type === "lmt" && LMT_POLICY) return LMT_POLICY;
      if (type === "ai" && AI_POLICY) return AI_POLICY;

      const storeKey = "policy:" + cacheKey;
      const cached = await readStore(storeKey);

      if (
        cached &&
        typeof cached.v === "string" &&
        Date.now() - Number(cached.t || 0) <
          (cached.v ? POLICY_CACHE_TTL_HIT : POLICY_CACHE_TTL_MISS)
      ) {
        return cached.v;
      }

      const found = await guard(
        firstWorkingPolicy(servicePolicyCandidates(id, type)),
        POLICY_RESOLVE_BUDGET,
        null
      );

      // 超时：本轮走默认路由，不写缓存，下次再试
      if (found === null) return "";

      await writeStore(storeKey, { v: found, t: Date.now() });
      return found;
    })();

    return servicePolicyCache[cacheKey];
  }

  async function resolveServicePolicyMap(ids, category) {
    const entries = await Promise.all(
      ids.map(async function (id) {
        return [
          id,
          await resolveServicePolicy(id, category)
        ];
      })
    );

    const map = {};

    entries.forEach(function (entry) {
      map[entry[0]] = entry[1];
    });

    return map;
  }

  async function getExit() {
    const baseResults = await Promise.all([
      getJSON("https://api.ipapi.is/?_=" + Date.now()),
      getJSON(
        "http://ip-api.com/json/?lang=zh-CN&fields=status,message,query,country,countryCode,regionName,city,isp,org,as,asname,proxy,hosting,mobile&_=" +
          Date.now()
      ),
      getJSON("https://ipwho.is/?lang=zh-CN&_=" + Date.now()),
      getJSON("https://ipinfo.io/json?_=" + Date.now())
    ]);

    const sourceNames = [
      "ipapi.is",
      "ip-api",
      "ipwho.is",
      "ipinfo"
    ];

    const candidates = [];

    for (let index = 0; index < baseResults.length; index += 1) {
      if (!baseResults[index].ok || !baseResults[index].data) {
        continue;
      }

      const parsed = parseExitSource(
        baseResults[index].data,
        sourceNames[index]
      );

      if (parsed.ip) {
        candidates.push(parsed);
      }
    }

    let merged = mergeExitSources(candidates);

    if (!merged.ip || merged.ip === "未识别") {
      return {
        ip: "未识别",
        city: "出口检测失败",
        region: "",
        country: "",
        countryCode: "",
        isp: "未知组织",
        kind: "未知网络",
        flags: {}
      };
    }

    const proxyCheck = await getProxyCheck(merged.ip);

    if (proxyCheck && proxyCheck.ip) {
      merged = mergeExitSources([merged, proxyCheck]);
    }

    return merged;
  }

  async function getLocalExit() {
    const results = await Promise.all([
      getJSONDirect(
        "http://ip-api.com/json/?lang=zh-CN&fields=status,message,query,country,countryCode,regionName,city,isp,org,as,asname&_=" +
          Date.now()
      ),
      getJSONDirect("https://ipwho.is/?lang=zh-CN&_=" + Date.now()),
      getJSONDirect("https://api.ipapi.is/?_=" + Date.now())
    ]);

    for (let index = 0; index < results.length; index += 1) {
      const parsed = parseLocalExit(
        results[index].data,
        FORCE_LOCAL_MAINLAND
      );

      if (results[index].ok && parsed.ip) {
        if (FORCE_LOCAL_MAINLAND && parsed.countryCode !== "CN") {
          return {
            ip: parsed.ip,
            city: "",
            region: "",
            country: "中国",
            countryCode: "CN",
            isp: parsed.isp || "",
            org: parsed.org || "",
            asname: parsed.asname || "",
            as: parsed.as || "",
            label: "中国大陆"
          };
        }

        return parsed;
      }
    }

    return LOCAL_EXIT_FAIL;
  }

  async function getDNSVerified() {
    const results = [await probeEDNSResolver()];

    if (!(results[0] && results[0].ok && results[0].ip)) {
      results.push(await probeEDNSResolver());
    }

    const valid = results.filter(function (item) {
      return item && item.ok && item.ip;
    });

    if (valid.length === 0) {
      return {
        ok: false,
        full: "",
        short: "",
        ip: "",
        geo: "",
        isp: "",
        org: "",
        asname: "",
        as: ""
      };
    }

    const primary = valid[0];

    const providerByText = providerFromText(
      [
        primary.geo,
        primary.ip,
        primary.isp,
        primary.org,
        primary.asname,
        primary.as
      ].join(" ")
    );

    if (providerByText.short) {
      return {
        ok: true,
        full: providerByText.full,
        short: providerByText.short,
        ip: primary.ip,
        geo: primary.geo,
        isp: primary.isp,
        org: primary.org,
        asname: primary.asname,
        as: primary.as
      };
    }

    const providerByIP = detectDNSProvider([primary.ip]);

    if (providerByIP.short && !isWeakDNSLabel(providerByIP.short)) {
      return {
        ok: true,
        full: providerByIP.full,
        short: providerByIP.short,
        ip: primary.ip,
        geo: primary.geo,
        isp: primary.isp,
        org: primary.org,
        asname: primary.asname,
        as: primary.as
      };
    }

    const ispLabel = compactDNSProviderName(
      primary.isp ||
      primary.org ||
      primary.asname ||
      primary.as ||
      primary.geo
    );

    return {
      ok: true,
      full: primary.isp || primary.org || primary.asname || primary.geo || "未知 DNS",
      short: ispLabel,
      ip: primary.ip,
      geo: primary.geo,
      isp: primary.isp,
      org: primary.org,
      asname: primary.asname,
      as: primary.as
    };
  }

  async function probeEDNSResolver() {
    const host = randomAlphaNum(32) + ".edns.ip-api.com";

    const result = await getJSONDirect(
      "http://" + host + "/json?_=" + Date.now()
    );

    if (!result.ok || !result.data) {
      return {
        ok: false,
        ip: "",
        geo: "",
        isp: "",
        org: "",
        asname: "",
        as: ""
      };
    }

    const dns = result.data.dns || {};
    const ip = clean(dns.ip);
    const geo = clean(dns.geo);

    if (!ip) {
      return {
        ok: false,
        ip: "",
        geo: geo,
        isp: "",
        org: "",
        asname: "",
        as: ""
      };
    }

    const info = await getDNSResolverInfo(ip);

    return {
      ok: true,
      ip: ip,
      geo: geo,
      isp: info.isp,
      org: info.org,
      asname: info.asname,
      as: info.as
    };
  }

  async function getDNSResolverInfo(ip) {
    const target = clean(ip);

    if (!target) {
      return {
        isp: "",
        org: "",
        asname: "",
        as: ""
      };
    }

    const result = await getJSONDirect(
      "http://ip-api.com/json/" +
        encodeURIComponent(target) +
        "?lang=zh-CN&fields=status,message,query,country,countryCode,regionName,city,isp,org,as,asname&_=" +
        Date.now()
    );

    if (!result.ok || !result.data || result.data.status === "fail") {
      return {
        isp: "",
        org: "",
        asname: "",
        as: ""
      };
    }

    return {
      isp: clean(result.data.isp),
      org: clean(result.data.org),
      asname: clean(result.data.asname),
      as: clean(result.data.as)
    };
  }

  async function getProxyLatency() {
    const measured = await measureLatencySet(
      GLOBAL_PROXY_LATENCY_URLS,
      false
    );

    return {
      ok: measured.ok,
      ms: measured.ms,
      target: measured.target
    };
  }

  async function getLocalLatency() {
    const measured = await measureLatencySet(
      MAINLAND_LATENCY_URLS,
      true
    );

    return {
      ok: measured.ok,
      ms: measured.ms,
      target: measured.target
    };
  }

  async function measureLatencySet(urls, direct) {
    const results = await Promise.all(
      urls.map(function (url) {
        return latencyProbe(url, direct);
      })
    );

    const passed = results
      .filter(function (item) {
        return item.ok && item.ms > 0;
      })
      .sort(function (a, b) {
        return a.ms - b.ms;
      });

    if (passed.length === 0) {
      return {
        ok: false,
        ms: 0,
        target: ""
      };
    }

    const best = passed[0];

    return {
      ok: true,
      ms: best.ms,
      target: best.url
    };
  }

  async function latencyProbe(url, direct) {
    const startedAt = Date.now();

    try {
      const response = direct
        ? await ctx.http.get(url, directRequestOptions())
        : await ctx.http.get(url, requestOptions());

      return {
        ok: response.status >= 200 && response.status < 400,
        status: response.status,
        ms: Math.max(1, Date.now() - startedAt),
        url: url
      };
    } catch (_) {
      return {
        ok: false,
        status: 0,
        ms: Math.max(1, Date.now() - startedAt),
        url: url
      };
    }
  }

  async function getProxyCheck(ip) {
    const target = clean(ip);

    if (!target || target === "未识别") {
      return null;
    }

    const result = await getJSON(
      "https://proxycheck.io/v2/" +
        encodeURIComponent(target) +
        "?vpn=1&asn=1&risk=1&time=1&_=" +
        Date.now()
    );

    if (!result.ok || !result.data) {
      return null;
    }

    return parseProxyCheck(result.data, target);
  }

  async function getQuic() {
    const urls = QUIC_TRACE_URLS.slice(0, 3).map(function (url) {
      return url + "?_=" + Date.now() + randomAlphaNum(5);
    });

    const results = await Promise.all(
      urls.map(function (url) {
        return getText(url);
      })
    );

    let hasH3 = false;
    let hasReachable = false;

    for (let index = 0; index < results.length; index += 1) {
      const item = results[index];

      if (!item || !item.ok) {
        continue;
      }

      hasReachable = true;

      const trace = parseTrace(item.text);
      const protocol = clean(trace.http).toLowerCase();

      if (
        protocol === "h3" ||
        protocol === "http3" ||
        protocol === "http/3" ||
        protocol.includes("h3") ||
        protocol.includes("http/3")
      ) {
        hasH3 = true;
        break;
      }
    }

    if (hasH3) {
      return {
        value: "✓/✓",
        tone: "green"
      };
    }

    return {
      value: hasReachable ? "—/—" : "×/×",
      tone: hasReachable ? "amber" : "red"
    };
  }

  async function testService(id, name, kind, color, url, servicePolicy) {
    const serviceExitPromise = getPolicyExit(servicePolicy);

    if (!url) {
      const emptyExit = await serviceExitPromise;

      return {
        id: id,
        name: name,
        kind: kind,
        color: color,
        ok: false,
        policy: servicePolicy || "",
        countryCode: emptyExit.countryCode || "",
        country: emptyExit.country || "",
        exit: emptyExit
      };
    }

    const separator = url.includes("?") ? "&" : "?";

    const [
      result,
      serviceExit
    ] = await Promise.all([
      getServiceStatus(
        url + separator + "_=" + Date.now(),
        servicePolicy
      ),
      serviceExitPromise
    ]);

    return {
      id: id,
      name: name,
      kind: kind,
      color: color,
      ok: result.ok,
      state: result.state || "fail",
      policy: servicePolicy || "",
      countryCode: serviceExit.countryCode || "",
      country: serviceExit.country || "",
      exit: serviceExit
    };
  }

  const EXIT_FAIL = {
    ip: "未识别",
    city: "出口检测失败",
    region: "",
    country: "",
    countryCode: "",
    isp: "未知组织",
    kind: "未知网络",
    flags: {}
  };

  const LOCAL_EXIT_FAIL = {
    ip: "",
    city: "",
    region: "",
    country: FORCE_LOCAL_MAINLAND ? "中国" : "",
    countryCode: FORCE_LOCAL_MAINLAND ? "CN" : "",
    isp: "",
    org: "",
    asname: "",
    as: "",
    label: FORCE_LOCAL_MAINLAND ? "中国大陆" : "直连检测失败"
  };

  const DNS_FAIL = {
    ok: false,
    full: "",
    short: "",
    ip: "",
    geo: "",
    isp: "",
    org: "",
    asname: "",
    as: ""
  };

  const LATENCY_FAIL = { ok: false, ms: 0, target: "" };
  const QUIC_FAIL = { value: "×/×", tone: "red" };

  function svc(id, name, kind, color, url, policy) {
    return guard(
      testService(id, name, kind, color, url, policy),
      TASK_DEADLINE,
      {
        id: id,
        name: name,
        kind: kind,
        color: color,
        ok: false,
        state: "fail",
        policy: policy || "",
        countryCode: "",
        country: "",
        exit: {}
      }
    );
  }

  const [
    mediaPolicyMap,
    aiPolicyMap
  ] = await Promise.all([
    resolveServicePolicyMap(MEDIA_SERVICE_IDS, "lmt"),
    resolveServicePolicyMap(AI_SERVICE_IDS, "ai")
  ]);

  const [
    exit,
    localExit,
    verifiedDNS,
    proxyLatency,
    localLatency,
    quic,
    media,
    ai
  ] = await Promise.all([
    guard(getExit(), TASK_DEADLINE, EXIT_FAIL),
    guard(getLocalExit(), TASK_DEADLINE, LOCAL_EXIT_FAIL),
    guard(getDNSVerified(), TASK_DEADLINE, DNS_FAIL),
    guard(getProxyLatency(), TASK_DEADLINE, LATENCY_FAIL),
    guard(getLocalLatency(), TASK_DEADLINE, LATENCY_FAIL),
    guard(getQuic(), TASK_DEADLINE, QUIC_FAIL),

    Promise.all([
      svc("netflix", "Netflix", "netflix", C.netflix, "https://www.netflix.com/title/81215567", mediaPolicyMap.netflix),
      svc("disney", "Disney+", "disney", C.disney, "https://www.disneyplus.com/", mediaPolicyMap.disney),
      svc("spotify", "Spotify", "spotify", C.spotify, "https://open.spotify.com/", mediaPolicyMap.spotify),
      svc("tiktok", "TikTok", "tiktok", C.tiktok, "https://www.tiktok.com/", mediaPolicyMap.tiktok),
      svc("youtube", "YouTube", "youtube", C.youtube, "https://www.youtube.com/", mediaPolicyMap.youtube),
      svc("prime", "Prime", "prime", C.prime, "https://www.primevideo.com/", mediaPolicyMap.prime)
    ]),

    Promise.all([
      svc("chatgpt", "ChatGPT", "chatgpt", C.chatgpt, "https://chatgpt.com/", aiPolicyMap.chatgpt),
      svc("claude", "Claude", "claude", C.claude, "https://claude.ai/", aiPolicyMap.claude),
      svc("gemini", "Gemini", "gemini", C.gemini, "https://gemini.google.com/", aiPolicyMap.gemini),
      svc("deepseek", "DeepSeek", "deepseek", C.deepseek, "https://chat.deepseek.com/", aiPolicyMap.deepseek),
      svc("grok", "Grok", "grok", C.grok, "https://grok.com/", aiPolicyMap.grok),
      svc("perplexity", "Perplexity", "perplexity", C.perplexity, "https://www.perplexity.ai/", aiPolicyMap.perplexity)
    ])
  ]);

  const carrierByDirectISP = carrierFromISP(
    [
      localExit.isp,
      localExit.org,
      localExit.asname,
      localExit.as
    ].join(" ")
  );

  if (!networkName && carrierByDirectISP) {
    networkName = carrierByDirectISP;
  }

  if (!networkName) {
    const iface = clean(
      pick(ipv4.interface, ipv4.iface, device.interface)
    ).toLowerCase();

    const hasWifiInfo = Object.keys(wifi).some(function (key) {
      return typeof wifi[key] !== "object" && isMeaningful(wifi[key]);
    });

    networkName = iface.startsWith("pdp_ip")
      ? "移动数据"
      : iface.startsWith("en") || hasWifiInfo
        ? "Wi-Fi"
        : "移动数据";
  }

  const dns = chooseDNSProvider(baseDNS, verifiedDNS);
  const dnsLabel = dnsTinyLabel(dns.short || dns.full);
  const localArea = localExit.label || "中国大陆";
  const nat = detectNAT(localIP, hasIPv6);
  const purity = purityScore(exit);
  const risk = riskLevel(exit, purity);

  const proxyLatencyColor = proxyLatency.ok
    ? proxyLatency.ms <= 220 ? C.green : C.amber
    : C.red;

  const localLatencyColor = localLatency.ok
    ? localLatency.ms <= 220 ? C.green : C.amber
    : C.red;

  const natColor = toneColor(nat.tone, C);
  const quicColor = toneColor(quic.tone, C);

  const purityColor =
    purity.score >= 75 ? C.green :
    purity.score >= 45 ? C.amber :
    C.red;

  const riskColor =
    risk === "低风险" ? C.green :
    risk === "中风险" ? C.amber :
    C.red;

  function merge(base, extra) {
    return scaleStyle(Object.assign({}, base || {}, extra || {}));
  }

  function text(value, size, weight, color, extra) {
    return merge(
      {
        type: "text",
        text: String(value),
        font: {
          size: FS(size),
          weight: weight || "regular"
        },
        textColor: color || C.text
      },
      extra
    );
  }

  function image(symbol, color, width, height, extra) {
    return merge(
      {
        type: "image",
        src: "sf-symbol:" + symbol,
        color: color || C.text,
        width: width || 10,
        height: height || 10
      },
      extra
    );
  }

  function rawImage(src, width, height, extra) {
    return merge(
      {
        type: "image",
        src: src,
        width: width,
        height: height,
        resizable: true
      },
      extra || {}
    );
  }

  function svgImage(svg, width, height, extra) {
    return rawImage(svgDataURI(svg), width, height, extra);
  }

  function row(children, extra) {
    return merge(
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        children: children || []
      },
      extra
    );
  }

  function col(children, extra) {
    return merge(
      {
        type: "stack",
        direction: "column",
        alignItems: "start",
        children: children || []
      },
      extra
    );
  }

  function spacer(length) {
    return length === undefined
      ? { type: "spacer" }
      : { type: "spacer", length: S(length) };
  }

  function card(children, extra) {
    return merge(
      {
        type: "stack",
        direction: "column",
        alignItems: "start",
        padding: [6, 7],
        gap: 4,
        backgroundColor: C.card,
        backgroundGradient: {
          type: "linear",
          colors: [C.cardTop, C.cardBottom],
          startPoint: { x: 0, y: 0 },
          endPoint: { x: 1, y: 1 }
        },
        borderRadius: 14,
        borderWidth: 1,
        borderColor: C.cardBorder,
        children: children || []
      },
      extra
    );
  }

  // 纯色渐变：Egern 对 backgroundColor 里的 {light,dark} 自适应色解析不可靠
  // （深色下会直接渲染成纯白、图标和文字一起看不见），而 backgroundGradient
  // 能正确解析（卡片的渐变就是这么正常显示的）。所以需要纯色背景的地方，
  // 用起止同色的渐变来画，backgroundColor 只留作兜底。
  function solidGradient(color) {
    return {
      type: "linear",
      colors: [color, color],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 0, y: 1 }
    };
  }

  function pill(value, tone, fill, extra) {
    return row(
      [
        text(value, 6, "semibold", tone, {
          maxLines: 1,
          minScale: 0.72,
          textAlign: "center"
        })
      ],
      merge(
        {
          padding: [2, 5],
          ...(glass ? {} : { backgroundColor: fill, borderRadius: 8 })
        },
        extra
      )
    );
  }

  function proxyTagLine(value, tone, fill) {
    return row(
      [
        text(value, 4.7, "semibold", tone, {
          maxLines: 1,
          minScale: 0.42,
          textAlign: "center"
        })
      ],
      {
        width: 37,
        height: 7.2,
        padding: [0.7, 2.5],
        ...(glass ? {} : { backgroundColor: fill, borderRadius: 4.8 }),
        alignItems: "center"
      }
    );
  }

  function proxyTagRows(tagOne, tagTwo, toneOne, fillOne, toneTwo, fillTwo) {
    return col(
      [
        proxyTagLine(tagOne, toneOne, fillOne),
        proxyTagLine(tagTwo, toneTwo, fillTwo)
      ],
      {
        width: 39,
        gap: 1,
        alignItems: "start"
      }
    );
  }

  function iconBox(symbol, tone, fill, side) {
    return row(
      [
        image(
          symbol,
          tone,
          Math.round(side * 0.52),
          Math.round(side * 0.52)
        )
      ],
      {
        width: side,
        height: side,
        padding: 3,
        ...(glass ? {} : { backgroundColor: fill, borderRadius: 12 })
      }
    );
  }

  function sectionTitle(symbol, title, right, tone) {
    const children = [
      image(symbol, tone, 11, 11),
      text(title, 10, "semibold", C.text, {
        maxLines: 1
      })
    ];

    if (right) {
      children.push(spacer());
      children.push(right);
    }

    return row(children, { gap: 3 });
  }

  function metricBox(symbol, label, value, tone, extra) {
    const options = extra || {};
    const valueSize = options.valueSize || 6.1;
    const valueMinScale = options.valueMinScale || 0.35;
    const labelSize = options.labelSize || 5;
    const labelMinScale = options.labelMinScale || 0.72;

    return col(
      [
        row(
          [
            image(symbol, tone, 7, 7),
            text(label, labelSize, "medium", C.muted, {
              maxLines: 1,
              minScale: labelMinScale,
              textAlign: "center"
            })
          ],
          {
            gap: 1,
            alignItems: "center"
          }
        ),

        text(value, valueSize, "semibold", tone, {
          maxLines: 1,
          minScale: valueMinScale,
          textAlign: "center"
        })
      ],
      {
        flex: 1,
        height: 24,
        padding: [0, 0],
        gap: 0,
        alignItems: "center"
      }
    );
  }

  function header() {
    return row(
      [
        row(
          [
            iconBox("waveform.path.ecg", C.blue, C.blueSoft, 28),

            col(
              [
                row(
                  [
                    text("网络诊断雷达", 11, "bold", C.text, {
                      maxLines: 1,
                      minScale: 0.72
                    }),

                    pill("Pro", C.purple, C.purpleSoft, {
                      padding: [1, 4]
                    })
                  ],
                  {
                    gap: 3,
                    alignItems: "center"
                  }
                ),

                text("Egern · 全面网络状态检测", 6, "medium", C.muted, {
                  maxLines: 1,
                  minScale: 0.78
                })
              ],
              {
                flex: 1,
                gap: 0
              }
            )
          ],
          {
            width: 171,
            height: 34,
            gap: 6
          }
        ),

        row(
          [
            spacer(),

            image("scope", C.purple, 11, 11),

            col(
              [
                text("当前策略", 5, "medium", C.muted, {
                  maxLines: 1,
                  textAlign: "center"
                }),

                row(
                  [
                    text(
                      POLICY ? "●" : "○",
                      7,
                      "bold",
                      POLICY ? C.green : C.purple
                    ),

                    text(POLICY_LABEL, 7, "semibold", C.text, {
                      maxLines: 1,
                      minScale: 0.72
                    })
                  ],
                  {
                    gap: 2,
                    alignItems: "center"
                  }
                )
              ],
              {
                width: 52,
                gap: 0,
                alignItems: "start"
              }
            ),

            spacer()
          ],
          {
            flex: 1,
            height: 34,
            padding: [3, 0],
            gap: 3
          }
        ),

        col(
          [
            text(timeLabel(now), 11, "bold", C.text, {
              maxLines: 1,
              minScale: 0.82,
              textAlign: "right"
            }),

            text(dateLabel(now), 5, "medium", C.muted, {
              maxLines: 1,
              minScale: 0.82,
              textAlign: "right"
            })
          ],
          {
            width: 43,
            height: 34,
            alignItems: "end",
            gap: 0
          }
        )
      ],
      {
        height: 34,
        gap: 4
      }
    );
  }

  function localCard() {
    return card(
      [
        sectionTitle(
          "wifi",
          "本地网络",
          image("globe.asia.australia.fill", C.blue, 12, 12),
          C.blue
        ),

        row(
          [
            iconBox("wifi", C.blue, C.blueSoft, 42),

            col(
              [
                row(
                  [
                    text(networkName, 11, "semibold", C.text, {
                      flex: 1,
                      maxLines: 1,
                      minScale: 0.68
                    }),

                    pill("已连接", C.green, C.greenSoft, {
                      padding: [1, 4]
                    })
                  ],
                  { gap: 3 }
                ),

                text(displayIP(localIP), 8, "medium", C.subtext, {
                  maxLines: 1,
                  minScale: 0.72
                }),

                row(
                  [
                    text(flag(localExit.countryCode) || (FORCE_LOCAL_MAINLAND ? "🇨🇳" : "🌐"), 8, "regular", C.text),

                    text(localArea, 7, "medium", C.muted, {
                      maxLines: 1,
                      minScale: 0.72
                    })
                  ],
                  { gap: 2 }
                )
              ],
              {
                flex: 1,
                gap: 1
              }
            )
          ],
          { gap: 6 }
        ),

        row(
          [
            metricBox(
              "router.fill",
              "网关",
              gatewayLabel(displayIP(gateway)),
              C.blue,
              {
                valueSize: 5.4,
                valueMinScale: 0.28
              }
            ),

            metricBox(
              "clock",
              "直连延迟",
              localLatency.ok ? localLatency.ms + "ms" : "失败",
              localLatencyColor
            ),

            metricBox(
              "network",
              "IPV4/IPV6",
              (hasIPv4 ? "✓" : "×") + "/" + (hasIPv6 ? "✓" : "×"),
              hasIPv4 && hasIPv6
                ? C.green
                : hasIPv4
                  ? C.amber
                  : C.red
            ),

            metricBox(
              "cloud.fill",
              "DNS",
              dnsLabel,
              C.purple,
              {
                valueSize: 5.4,
                valueMinScale: 0.28
              }
            )
          ],
          { gap: 2 }
        )
      ],
      {
        flex: 1,
        height: 100
      }
    );
  }

  // 国旗：透明版用松鼠 logo（用户发的图，白底已抠透明、水印已去掉）；
  // 正常版（classic）仍用原版国旗表情。
  const SQUIRREL_PNG = "data:image/png;base64,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";
  function flagBox() {
    return row(
      [
        glass
          ? rawImage(SQUIRREL_PNG, 36, 22)
          : text(flag(exit.countryCode) || "🌐", 22, "regular", C.text, {
              maxLines: 1,
              textAlign: "center"
            })
      ],
      {
        width: 36,
        height: 36,
        padding: 2,
        ...(glass ? {} : { backgroundColor: C.purpleSoft, borderRadius: 11 })
      }
    );
  }

  function scoreGauge() {
    return svgImage(
      purityGaugeSVG(
        purity.score,
        {
          track: uiColor(C.scoreTrack),
          left: uiColor(C.scoreLeft),
          right: uiColor(C.scoreRight),
          glow: uiColor(C.scoreGlow),
          text: uiColor(C.scoreLeft),
          muted: uiColor(C.muted)
        }
      ),
      68,
      52,
      {
        borderRadius: 16
      }
    );
  }

  function proxyCard() {
    const city =
      clean(exit.city) ||
      clean(exit.country) ||
      "未知地区";

    const tagOne = exit.kind || "未知网络";

    const tagTwo =
      clean(exit.cloudProvider) ||
      (
        exit.kind === "住宅 IP"
          ? "原生住宅"
          : exit.kind === "移动网络"
            ? "移动出口"
            : exit.kind === "商业机房"
              ? "商业机房"
              : "出口网络"
      );

    const tagOneTone =
      exit.kind === "商业机房"
        ? C.amber
        : C.green;

    const tagOneFill =
      exit.kind === "商业机房"
        ? C.amberSoft
        : C.greenSoft;

    const tagTwoTone = C.green;
    const tagTwoFill = C.greenSoft;

    return card(
      [
        sectionTitle(
          "point.3.connected.trianglepath.dotted",
          "当前代理",
          pill(
            proxyLatency.ok ? "连接正常" : "检测失败",
            proxyLatency.ok ? C.green : C.red,
            proxyLatency.ok ? C.greenSoft : C.redSoft
          ),
          C.purple
        ),

        row(
          [
            flagBox(),

            col(
              [
                row(
                  [
                    text(flag(exit.countryCode) || "🌐", 7, "regular", C.text),

                    text(city, 9.2, "semibold", C.text, {
                      flex: 1,
                      maxLines: 1,
                      minScale: 0.55
                    })
                  ],
                  { gap: 2 }
                ),

                text(shortISP(exit.isp), 7.2, "medium", C.subtext, {
                  maxLines: 1,
                  minScale: 0.62
                }),

                proxyTagRows(
                  tagOne,
                  tagTwo,
                  tagOneTone,
                  tagOneFill,
                  tagTwoTone,
                  tagTwoFill
                )
              ],
              {
                flex: 1,
                gap: 1
              }
            ),

            row(
              [
                scoreGauge()
              ],
              {
                width: 68,
                height: 52,
                alignItems: "center",
                justifyContent: "center"
              }
            )
          ],
          {
            gap: 4,
            alignItems: "center"
          }
        ),

        row(
          [
            metricBox(
              "clock",
              "延迟",
              proxyLatency.ok ? proxyLatency.ms + "ms" : "失败",
              proxyLatencyColor
            ),

            metricBox(
              "circle.hexagongrid.fill",
              "NAT",
              nat.label,
              natColor
            ),

            metricBox(
              "paperplane.fill",
              "UDP/QUIC",
              quic.value,
              quicColor,
              {
                labelSize: 4.25,
                labelMinScale: 0.38
              }
            ),

            metricBox(
              "slider.horizontal.3",
              "协议",
              NODE_PROTOCOL,
              C.purple,
              {
                valueSize: 5.4,
                valueMinScale: 0.34
              }
            )
          ],
          { gap: 2 }
        )
      ],
      {
        flex: 1,
        height: 100,
        padding: [5, 6],
        gap: 3
      }
    );
  }

  function serviceLogoLarge(item) {
    const base = {
      width: 23,
      height: 23,
      padding: 2,
      backgroundColor: C.tileIconBg,
      borderRadius: 7
    };

    if (item.kind === "spotify") {
      return row(
        [
          image("dot.radiowaves.left.and.right", item.color, 15, 15)
        ],
        base
      );
    }

    if (item.kind === "tiktok") {
      return row(
        [
          image("music.note", item.color, 15, 15)
        ],
        base
      );
    }

    if (item.kind === "youtube") {
      return row(
        [
          image("play.rectangle.fill", item.color, 15, 15)
        ],
        base
      );
    }

    if (item.kind === "prime") {
      return row(
        [
          image("play.tv.fill", item.color, 15, 15)
        ],
        base
      );
    }

    if (item.kind === "chatgpt") {
      return row(
        [
          image("circle.hexagongrid", item.color, 15, 15)
        ],
        base
      );
    }

    if (item.kind === "gemini") {
      return row(
        [
          image("sparkles", item.color, 15, 15)
        ],
        base
      );
    }

    if (item.kind === "grok") {
      return row(
        [
          text("G", 13, "bold", item.color, {
            maxLines: 1,
            textAlign: "center"
          })
        ],
        base
      );
    }

    if (item.kind === "perplexity") {
      return row(
        [
          image("magnifyingglass", item.color, 14, 14)
        ],
        base
      );
    }

    const mark =
      item.kind === "netflix"
        ? "N"
        : item.kind === "disney"
          ? "D+"
          : item.kind === "deepseek"
            ? "D"
            : "AI";

    const fontSize =
      item.kind === "claude"
        ? 10
        : item.kind === "disney"
          ? 10
          : 13;

    return row(
      [
        text(mark, fontSize, "bold", item.color, {
          maxLines: 1,
          textAlign: "center"
        })
      ],
      base
    );
  }

  function compactServiceTile(item) {
    const statusColor = item.ok
      ? C.green
      : item.state === "limited" ? C.amber : C.red;
    const statusText = item.ok
      ? "OK"
      : item.state === "limited" ? "受限" : "失败";
    const serviceCountryCode =
      countryCode(item.countryCode) ||
      countryCode(exit.countryCode);

    const serviceRegionLabel = serviceCountryCode
      ? flag(serviceCountryCode) + " " + serviceCountryCode
      : "NET";

    return row(
      [
        serviceLogoLarge(item),

        col(
          [
            text(item.name, 7, "semibold", C.text, {
              maxLines: 1,
              minScale: 0.66
            }),

            row(
              [
                text(
                  serviceRegionLabel,
                  5,
                  "medium",
                  C.subtext,
                  {
                    maxLines: 1
                  }
                ),

                text(
                  statusText,
                  5.6,
                  "semibold",
                  statusColor,
                  {
                    maxLines: 1
                  }
                )
              ],
              { gap: 2 }
            )
          ],
          {
            flex: 1,
            gap: 1
          }
        )
      ],
      {
        flex: 1,
        height: 31,
        padding: [4, 4],
        gap: 4,
        backgroundColor: C.tileBg,
        borderRadius: 9,
        borderWidth: 1,
        borderColor: C.tileBorder
      }
    );
  }

  function serviceGrid(items) {
    return col(
      [
        row(
          [
            compactServiceTile(items[0]),
            compactServiceTile(items[1])
          ],
          {
            height: 31,
            gap: 5
          }
        ),

        row(
          [
            compactServiceTile(items[2]),
            compactServiceTile(items[3])
          ],
          {
            height: 31,
            gap: 5
          }
        ),

        row(
          [
            compactServiceTile(items[4]),
            compactServiceTile(items[5])
          ],
          {
            height: 31,
            gap: 5
          }
        )
      ],
      {
        flex: 1,
        height: 101,
        gap: 4
      }
    );
  }

  function serviceCard(title, symbol, items, tone) {
    const passed = items.filter(item => item.ok).length;

    return card(
      [
        sectionTitle(
          symbol,
          title,
          pill(
            passed + "/" + items.length,
            passed === items.length ? C.green : C.amber,
            passed === items.length ? C.greenSoft : C.amberSoft
          ),
          tone
        ),

        serviceGrid(items)
      ],
      {
        flex: 1,
        height: 133,
        padding: [5, 6],
        gap: 5
      }
    );
  }

  function footerCell(symbol, label, value, tone) {
    return col(
      [
        row(
          [
            image(symbol, tone, 13, 13),

            col(
              [
                text(label, 6, "medium", C.muted, {
                  maxLines: 1
                }),

                text(value, 7, "semibold", tone, {
                  maxLines: 1,
                  minScale: 0.64
                })
              ],
              {
                flex: 1,
                gap: 0
              }
            )
          ],
          {
            gap: 4
          }
        )
      ],
      {
        flex: 1,
        padding: [1, 3]
      }
    );
  }

  function footer() {
    return card(
      [
        row(
          [
            footerCell(
              "server.rack",
              "ISP / 厂商",
              shortISP(exit.isp),
              C.blue
            ),

            footerCell(
              "house.fill",
              "属性类型",
              exit.kind,
              exit.kind === "商业机房"
                ? C.amber
                : C.green
            ),

            footerCell(
              "checkmark.shield.fill",
              "纯净评分",
              purity.score + "分",
              purityColor
            ),

            footerCell(
              "shield.lefthalf.filled",
              "风险等级",
              risk,
              riskColor
            ),

            footerCell(
              "arrow.clockwise",
              "更新时间",
              timeLabel(now),
              C.purple
            )
          ],
          {
            height: 30,
            padding: [0, 0],
            gap: 0,
            alignItems: "center"
          }
        )
      ],
      {
        height: 40,
        padding: [4, 5],
        gap: 0
      }
    );
  }

  const dashboard = col(
    [
      header(),

      row(
        [
          localCard(),
          proxyCard()
        ],
        {
          height: 100,
          gap: 6,
          alignItems: "start"
        }
      ),

      row(
        [
          serviceCard("流媒体解锁", "play.rectangle.fill", media, C.blue),
          serviceCard("AI 解锁检测", "sparkles", ai, C.purple)
        ],
        {
          height: 133,
          gap: 6,
          alignItems: "start"
        }
      ),

      footer()
    ],
    {
      height: 342,
      padding: [8, 8],
      gap: 6
    }
  );

  return {
    type: "widget",
    padding: S(8),
    gap: 0,
    ...(glass ? {} : { backgroundColor: C.root }),
    refreshAfter: new Date(
      Date.now() + REFRESH_MINUTES * 60 * 1000
    ).toISOString(),
    children: [
      dashboard,
      spacer()
    ]
  };
}

function styleMode(env) {
  // 透明/经典切换：WIDGET_STYLE=glass（默认，根容器不设背景，壁纸透出来）| classic
  const value = String((env || {}).WIDGET_STYLE || "glass").trim().toLowerCase();
  return value === "classic" ? "classic" : "glass";
}

function palette(glass) {
  const adaptive = (light, dark) => ({
    light: light,
    dark: dark
  });

  // 色块只在 glass 下拿掉（iconBox/pill/proxyTagLine/flagBox 不画底色，只留图标和字），
  // classic 下恢复原版底色+圆角。所以强调色/品牌色直接用回原版自适应色：
  // 浅色下渲染彩色（图一效果），深色下渲染白色——
  // 没有底色挡着，白图标/白字在深色壁纸和灰卡片上都看得见。
  // 之前单色方案（glass 下强制白字灰底）错在浅色下也白字，白底上全隐形。

  return {
    root: adaptive("#E3EAF5", "#07101F"),

    dashboard: adaptive("#E3EAF5", "#07101F"),
    dashboardBorder: adaptive("#E3EAF5", "#07101F"),

    // glass 模式：卡片/磁贴用半透明，壁纸能透进来；classic 保持原版纯色
    card: glass ? adaptive("rgba(255,255,255,0.55)", "rgba(255,255,255,0.08)") : adaptive("#F7FAFF", "#101A2D"),
    cardTop: glass ? adaptive("rgba(255,255,255,0.65)", "rgba(255,255,255,0.10)") : adaptive("#FFFFFF", "#142039"),
    cardBottom: glass ? adaptive("rgba(255,255,255,0.45)", "rgba(255,255,255,0.06)") : adaptive("#F0F5FF", "#0D1728"),

    proxyTop: adaptive("#FFFFFF", "#142039"),
    proxyBottom: adaptive("#F0F5FF", "#0D1728"),

    cardBorder: adaptive("#B5C7E5", "#30476F"),

    tileBg: glass ? adaptive("rgba(255,255,255,0.40)", "rgba(255,255,255,0.08)") : adaptive("#EDF3FC", "#162238"),
    tileIconBg: glass ? adaptive("rgba(255,255,255,0.50)", "rgba(255,255,255,0.10)") : adaptive("#DFE9F8", "#1D3154"),
    tileBorder: adaptive("#B7C8E6", "#2E4876"),

    scoreTrack: adaptive("#D8E1EA", "#273045"),
    scoreGlow: adaptive("#1AE27F", "#1AE27F"),
    scoreLeft: adaptive("#22C96D", "#3BE28A"),
    scoreRight: adaptive("#E25769", "#FF627A"),

    footerDivider: adaptive("#C7D2E6", "#32486D"),

    text: adaptive("#18253F", "#F1F5FF"),
    subtext: adaptive("#4E617F", "#BBC8E0"),
    muted: adaptive("#74839A", "#8694AE"),

    blue: adaptive("#2E74D2", "#70AEFF"),
    blueSoft: adaptive("#DDEAFF", "#183B71"),

    purple: adaptive("#7C63D8", "#B09AFF"),
    purpleSoft: adaptive("#EAE3FF", "#31275A"),

    green: adaptive("#229B62", "#58D79D"),
    greenSoft: adaptive("#DDF7E8", "#163F34"),

    amber: adaptive("#B9821D", "#FFC866"),
    amberSoft: adaptive("#FFF0D0", "#503918"),

    red: adaptive("#D64A59", "#FF7D88"),
    redSoft: adaptive("#FFE2E6", "#4A232C"),

    netflix: adaptive("#E50914", "#FF505B"),
    disney: adaptive("#2B76D8", "#7DB7FF"),
    spotify: adaptive("#1DB954", "#1ED760"),
    tiktok: adaptive("#111827", "#FFFFFF"),
    youtube: adaptive("#FF0033", "#FF4B4B"),
    prime: adaptive("#1978CC", "#7CB8FF"),

    chatgpt: adaptive("#1F2937", "#EAF0FF"),
    claude: adaptive("#C86B35", "#FFA26E"),
    gemini: adaptive("#6D6FE8", "#9EA9FF"),
    deepseek: adaptive("#1D6FD8", "#61AAFF"),
    grok: adaptive("#111827", "#F1F5FF"),
    perplexity: adaptive("#0B88A8", "#63D9FF")
  };
}

function servicePolicyCandidates(serviceId, category) {
  const id = clean(serviceId).toLowerCase();
  const type = clean(category).toLowerCase();

  const commonLMT = [
    "LMT",
    "流媒体",
    "流媒体解锁",
    "流媒体服务",
    "流媒体策略",
    "流媒体节点",
    "全球流媒体",
    "国际流媒体",
    "国外流媒体",
    "海外流媒体",
    "全球媒体",
    "国际媒体",
    "国外媒体",
    "海外媒体",
    "媒体",
    "媒体服务",
    "媒体解锁",
    "影音",
    "影音娱乐",
    "影音解锁",
    "视频",
    "视频服务",
    "视频解锁",
    "串流",
    "串流媒体",
    "串流媒體",
    "流媒體",
    "解锁",
    "解鎖",
    "国际解锁",
    "海外解锁",
    "Global Media",
    "International Media",
    "Overseas Media",
    "Media",
    "Media Unlock",
    "Unlock Media",
    "Streaming",
    "Streaming Media",
    "Streaming Unlock",
    "Global Streaming",
    "International Streaming",
    "Overseas Streaming",
    "Proxy Media",
    "Stream",
    "Video",
    "Video Streaming",
    "TV",
    "Movie",
    "Movies",
    "Entertainment",
    "NETFLIX",
    "Netflix",
    "Disney",
    "Disney+",
    "YouTube",
    "Spotify",
    "Prime",
    "Prime Video",
    "TikTok",
    "HBO",
    "Max",
    "Hulu",
    "Apple TV",
    "Apple TV+",
    "Emby",
    "Plex",
    "動畫瘋",
    "动画疯",
    "Bahamut",
    "Bilibili 港澳台",
    "哔哩哔哩港澳台",
    "港台番剧",
    "港台",
    "🎬 流媒体",
    "📺 流媒体",
    "🎥 流媒体",
    "🎞 流媒体",
    "🍿 流媒体",
    "🎬 Streaming",
    "📺 Streaming",
    "🎥 Streaming",
    "🎬 Media",
    "📺 Media",
    "🍿 Media"
  ];

  const commonAI = [
    "AI",
    "Ai",
    "ai",
    "人工智能",
    "人工智能服务",
    "AI服务",
    "AI 服务",
    "AI解锁",
    "AI 解锁",
    "AI平台",
    "AI 平台",
    "AI工具",
    "AI 工具",
    "AI策略",
    "AI 策略",
    "AI节点",
    "AI 节点",
    "AI專用",
    "AI专用",
    "AI国外",
    "AI海外",
    "全球AI",
    "国际AI",
    "国外AI",
    "海外AI",
    "AIGC",
    "AGI",
    "LLM",
    "OpenAI",
    "Open AI",
    "ChatGPT",
    "Chat GPT",
    "GPT",
    "GPT4",
    "GPT-4",
    "GPT-5",
    "Claude",
    "Anthropic",
    "Gemini",
    "Google AI",
    "Bard",
    "DeepSeek",
    "Grok",
    "xAI",
    "XAI",
    "Perplexity",
    "Copilot",
    "Microsoft Copilot",
    "Poe",
    "Notion AI",
    "Midjourney",
    "Sora",
    "Cursor",
    "AI Proxy",
    "AI Services",
    "AI Unlock",
    "AI Global",
    "Global AI",
    "International AI",
    "Overseas AI",
    "Proxy AI",
    "🤖 AI",
    "✨ AI",
    "🧠 AI",
    "🤖 人工智能",
    "✨ 人工智能",
    "🧠 人工智能"
  ];

  const serviceMap = {
    netflix: [
      "Netflix",
      "NETFLIX",
      "NetFlix",
      "NF",
      "奈飞",
      "奈飛",
      "网飞",
      "網飛",
      "Netflix 解锁",
      "Netflix 解鎖",
      "Netflix Unlock",
      "Netflix 专用",
      "Netflix 專用",
      "Netflix节点",
      "Netflix 節点",
      "NF解锁",
      "NF 解锁",
      "NF Unlock",
      "Netflix/Disney",
      "Netflix & Disney",
      "Netflix Disney",
      "奈飞节点",
      "奈飞解锁",
      "🎬 Netflix",
      "🎥 Netflix",
      "🍿 Netflix"
    ],

    disney: [
      "Disney+",
      "Disney",
      "Disney Plus",
      "DisneyPlus",
      "D+",
      "DPlus",
      "迪士尼",
      "迪士尼+",
      "Disney 解锁",
      "Disney+ 解锁",
      "Disney Unlock",
      "DisneyPlus 解锁",
      "Disney 专用",
      "Disney 專用",
      "Disney 节点",
      "Disney 節点",
      "Disney+ 节点",
      "Disney+ 節点",
      "🎬 Disney+",
      "🏰 Disney+",
      "🎥 Disney"
    ],

    spotify: [
      "Spotify",
      "SPOTIFY",
      "声破天",
      "聲破天",
      "Spotify 解锁",
      "Spotify Unlock",
      "Spotify Premium",
      "Spotify 专用",
      "Spotify 專用",
      "Spotify 节点",
      "Spotify 節点",
      "音乐",
      "音樂",
      "Music",
      "🎵 Spotify",
      "🎧 Spotify"
    ],

    tiktok: [
      "TikTok",
      "Tik Tok",
      "TIKTOK",
      "TK",
      "抖音国际版",
      "抖音國際版",
      "国际抖音",
      "國際抖音",
      "TikTok 解锁",
      "TikTok Unlock",
      "TikTok 专用",
      "TikTok 專用",
      "TikTok 节点",
      "TikTok 節点",
      "🎵 TikTok",
      "🎬 TikTok"
    ],

    youtube: [
      "YouTube",
      "Youtube",
      "YOUTUBE",
      "YT",
      "油管",
      "YouTube 解锁",
      "YouTube Unlock",
      "YouTube Premium",
      "YouTube Music",
      "YT Premium",
      "YT 解锁",
      "YT Unlock",
      "Google",
      "Google YouTube",
      "谷歌",
      "谷歌服务",
      "谷歌服務",
      "Google Services",
      "Google Service",
      "🎬 YouTube",
      "📺 YouTube",
      "▶️ YouTube"
    ],

    prime: [
      "Prime",
      "Prime Video",
      "PrimeVideo",
      "Amazon Prime",
      "Amazon Video",
      "Amazon",
      "亚马逊视频",
      "亞馬遜視頻",
      "亚马逊",
      "亞馬遜",
      "Prime 解锁",
      "Prime Unlock",
      "Prime Video 解锁",
      "Prime Video Unlock",
      "Prime 专用",
      "Prime 專用",
      "Prime 节点",
      "Prime 節点",
      "🎬 Prime",
      "📺 Prime"
    ],

    chatgpt: [
      "ChatGPT",
      "Chat GPT",
      "OpenAI",
      "Open AI",
      "GPT",
      "GPT4",
      "GPT-4",
      "GPT5",
      "GPT-5",
      "OpenAI 解锁",
      "ChatGPT 解锁",
      "OpenAI Unlock",
      "ChatGPT Unlock",
      "OpenAI 专用",
      "OpenAI 專用",
      "ChatGPT 专用",
      "ChatGPT 專用",
      "OpenAI 节点",
      "ChatGPT 节点",
      "🤖 ChatGPT",
      "🤖 OpenAI",
      "✨ ChatGPT"
    ],

    claude: [
      "Claude",
      "Anthropic",
      "Claude AI",
      "Claude 解锁",
      "Claude Unlock",
      "Anthropic 解锁",
      "Anthropic Unlock",
      "Claude 专用",
      "Claude 專用",
      "Claude 节点",
      "Claude 節点",
      "🤖 Claude",
      "🧠 Claude"
    ],

    gemini: [
      "Gemini",
      "Google AI",
      "Bard",
      "Google Bard",
      "Gemini 解锁",
      "Gemini Unlock",
      "Google AI 解锁",
      "Google AI Unlock",
      "Gemini 专用",
      "Gemini 專用",
      "Gemini 节点",
      "Gemini 節点",
      "Google",
      "谷歌",
      "谷歌 AI",
      "🤖 Gemini",
      "✨ Gemini"
    ],

    deepseek: [
      "DeepSeek",
      "Deepseek",
      "DEEPSEEK",
      "深度求索",
      "DeepSeek 解锁",
      "DeepSeek Unlock",
      "DeepSeek 专用",
      "DeepSeek 專用",
      "DeepSeek 节点",
      "DeepSeek 節点",
      "🤖 DeepSeek",
      "🧠 DeepSeek"
    ],

    grok: [
      "Grok",
      "grok",
      "GROK",
      "xAI",
      "XAI",
      "X AI",
      "Grok 解锁",
      "Grok Unlock",
      "xAI 解锁",
      "xAI Unlock",
      "Grok 专用",
      "Grok 專用",
      "Grok 节点",
      "Grok 節点",
      "X",
      "Twitter AI",
      "🤖 Grok",
      "✨ Grok"
    ],

    perplexity: [
      "Perplexity",
      "PERPLEXITY",
      "Perplexity AI",
      "Perplexity 解锁",
      "Perplexity Unlock",
      "Perplexity 专用",
      "Perplexity 專用",
      "Perplexity 节点",
      "Perplexity 節点",
      "PPLX",
      "PPLX AI",
      "🤖 Perplexity",
      "🔎 Perplexity"
    ]
  };

  const serviceCandidates = serviceMap[id] || [];

  if (type === "ai") {
    return serviceCandidates.concat(commonAI);
  }

  return serviceCandidates.concat(commonLMT);
}

function dedupeCandidates(values) {
  const seen = {};
  const output = [];

  (values || []).forEach(function (value) {
    const raw = clean(value);
    const key = raw;

    if (!raw || seen[key]) {
      return;
    }

    seen[key] = true;
    output.push(raw);
  });

  return output;
}

function getLocalNetworkName(device) {
  const wifi = (device && device.wifi) || {};
  const cellular = (device && device.cellular) || {};

  const wifiName = firstMeaningful(
    wifi.ssid,
    wifi.name,
    wifi.networkName,
    getAt(device, "network.ssid"),
    getAt(device, "wifiSSID")
  );

  if (wifiName) {
    return wifiName;
  }

  const carrierName = firstMeaningful(
    cellular.carrier,
    cellular.carrierName,
    cellular.operator,
    cellular.operatorName,
    cellular.network,
    cellular.networkName,
    cellular.provider,
    cellular.serviceProvider,

    getAt(device, "carrier"),
    getAt(device, "carrierName"),
    getAt(device, "operator"),
    getAt(device, "operatorName"),
    getAt(device, "network.carrier"),
    getAt(device, "network.carrierName"),
    getAt(device, "network.operator"),
    getAt(device, "telephony.carrier"),
    getAt(device, "telephony.carrierName"),
    getAt(device, "cellularProvider")
  );

  if (carrierName) {
    return normalizeCarrierName(carrierName);
  }

  const code = firstMeaningful(
    cellular.mccmnc,
    cellular.mccMnc,
    cellular.plmn,
    cellular.operatorCode,
    getAt(device, "network.mccmnc"),
    getAt(device, "network.plmn"),
    getAt(device, "telephony.mccmnc")
  );

  const byCode = carrierByMCCMNC(code);

  if (byCode) {
    return byCode;
  }

  const mcc = firstMeaningful(
    cellular.mcc,
    cellular.mobileCountryCode,
    getAt(device, "network.mcc"),
    getAt(device, "telephony.mobileCountryCode")
  );

  const mnc = firstMeaningful(
    cellular.mnc,
    cellular.mobileNetworkCode,
    getAt(device, "network.mnc"),
    getAt(device, "telephony.mobileNetworkCode")
  );

  const byMccMnc = carrierByMCCMNC(clean(mcc) + clean(mnc));

  if (byMccMnc) {
    return byMccMnc;
  }

  return "";
}

function firstMeaningful() {
  for (let index = 0; index < arguments.length; index += 1) {
    const value = clean(arguments[index]);

    if (isMeaningful(value)) {
      return value;
    }
  }

  return "";
}

function isMeaningful(value) {
  const v = clean(value);
  const lower = v.toLowerCase();

  if (!v) return false;
  if (v === "--") return false;
  if (v === "-") return false;
  if (v === "—") return false;
  if (lower === "null") return false;
  if (lower === "undefined") return false;
  if (lower === "unknown") return false;
  if (lower === "unknow") return false;
  if (lower === "none") return false;
  if (lower === "n/a") return false;
  if (lower === "wifi") return false;
  if (lower === "wlan") return false;
  if (lower === "5g") return false;
  if (lower === "4g") return false;
  if (lower === "lte") return false;
  if (lower === "nr") return false;

  return true;
}

function normalizeCarrierName(value) {
  const raw = clean(value);
  const lower = raw.toLowerCase();

  if (!raw) return "";

  if (
    raw.includes("中国移动") ||
    lower.includes("china mobile") ||
    lower.includes("cmcc") ||
    lower.includes("cmnet") ||
    lower.includes("cmi")
  ) {
    return "中国移动";
  }

  if (
    raw.includes("中国联通") ||
    lower.includes("china unicom") ||
    lower.includes("unicom") ||
    lower.includes("cucc")
  ) {
    return "中国联通";
  }

  if (
    raw.includes("中国电信") ||
    lower.includes("china telecom") ||
    lower.includes("chinanet") ||
    lower.includes("telecom") ||
    lower.includes("ctc")
  ) {
    return "中国电信";
  }

  if (
    raw.includes("中国广电") ||
    lower.includes("china broadnet") ||
    lower.includes("cbn") ||
    lower.includes("broadnet") ||
    lower.includes("broadcasting network")
  ) {
    return "中国广电";
  }

  return raw;
}

function carrierFromISP(value) {
  const name = normalizeCarrierName(value);
  return ["中国移动", "中国联通", "中国电信", "中国广电"].includes(name)
    ? name
    : "";
}

function carrierByMCCMNC(value) {
  const code = clean(value).replace(/\D/g, "");

  const mobile = [
    "46000",
    "46002",
    "46004",
    "46007",
    "46008"
  ];

  const unicom = [
    "46001",
    "46006",
    "46009"
  ];

  const telecom = [
    "46003",
    "46005",
    "46011",
    "46012"
  ];

  const broadnet = [
    "46015"
  ];

  if (mobile.includes(code)) return "中国移动";
  if (unicom.includes(code)) return "中国联通";
  if (telecom.includes(code)) return "中国电信";
  if (broadnet.includes(code)) return "中国广电";

  return "";
}

function maskIP(value) {
  const raw = clean(value);

  if (!raw || raw === "未获取" || raw === "—" || raw === "-") {
    return raw;
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) {
    const parts = raw.split(".");
    return parts[0] + "." + parts[1] + ".*.*";
  }

  if (raw.includes(".")) {
    return raw.replace(
      /(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}/g,
      "$1.$2.*.*"
    );
  }

  if (raw.includes(":")) {
    const parts = raw.split(":").filter(Boolean);
    if (parts.length >= 2) {
      return parts[0] + ":" + parts[1] + ":****:****";
    }
  }

  return raw;
}

function purityGaugeSVG(score, colors) {
  const value = Math.max(0, Math.min(100, Number(score) || 0));

  const cx = 75;
  const cy = 85;
  const rx = 55;
  const ry = 55;

  const theta = Math.PI - Math.PI * value / 100;
  const px = cx + rx * Math.cos(theta);
  const py = cy - ry * Math.sin(theta);

  const safeTrack = svgColor(colors.track, "#D8E1EA");
  const safeLeft = svgColor(colors.left, "#22C96D");
  const safeRight = svgColor(colors.right, "#E25769");
  const safeGlow = svgColor(colors.glow, "#1AE27F");
  const safeText = svgColor(colors.text, "#22C96D");
  const safeMuted = svgColor(colors.muted, "#74839A");

  const leftDash =
    value >= 99.9
      ? "100 0"
      : Math.max(0.1, value).toFixed(1) + " 100";

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="112" viewBox="0 0 150 112">',
    "<defs>",
    '<filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">',
    '<feGaussianBlur stdDeviation="2.1" result="blur"/>',
    "<feMerge>",
    '<feMergeNode in="blur"/>',
    '<feMergeNode in="SourceGraphic"/>',
    "</feMerge>",
    "</filter>",
    "</defs>",
    '<path d="M20 85 A55 55 0 0 1 130 85" fill="none" stroke="' + safeTrack + '" stroke-width="9" stroke-linecap="round" opacity="0.75"/>',
    '<path d="M20 85 A55 55 0 0 1 130 85" fill="none" stroke="' + safeRight + '" stroke-width="8.2" stroke-linecap="round" opacity="0.95"/>',
    '<path d="M20 85 A55 55 0 0 1 130 85" fill="none" stroke="' + safeGlow + '" stroke-width="13" stroke-linecap="round" pathLength="100" stroke-dasharray="' + leftDash + '" opacity="0.16"/>',
    '<path d="M20 85 A55 55 0 0 1 130 85" fill="none" stroke="' + safeLeft + '" stroke-width="8.4" stroke-linecap="round" pathLength="100" stroke-dasharray="' + leftDash + '" opacity="1"/>',
    '<circle cx="' + px.toFixed(2) + '" cy="' + py.toFixed(2) + '" r="6.5" fill="' + safeGlow + '" opacity="0.20"/>',
    '<circle cx="' + px.toFixed(2) + '" cy="' + py.toFixed(2) + '" r="4.2" fill="' + safeLeft + '" filter="url(#softGlow)" opacity="1"/>',
    '<text x="75" y="61" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif" font-size="30" font-weight="850" fill="' + safeText + '">' + Math.round(value) + "</text>",
    '<text x="75" y="75" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif" font-size="10" font-weight="760" fill="' + safeMuted + '">/100</text>',
    '<text x="75" y="90" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif" font-size="10" font-weight="760" fill="' + safeMuted + '">纯净评分</text>',
    "</svg>"
  ].join("");
}

function svgDataURI(svg) {
  return "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(svg)
      .replace(/'/g, "%27")
      .replace(/"/g, "%22");
}

function svgColor(value, fallback) {
  const color = clean(value);
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  if (/^#[0-9a-fA-F]{3}$/.test(color)) return color;
  return fallback;
}

function getCurrentProxyInfo(ctx) {
  const proxyName = clean(
    pick(
      getAt(ctx, "node.name"),
      getAt(ctx, "proxy.name"),
      getAt(ctx, "currentProxy.name"),
      getAt(ctx, "selectedProxy.name"),
      getAt(ctx, "selectedNode.name"),
      getAt(ctx, "policy.node.name"),
      getAt(ctx, "policy.selected.name"),
      getAt(ctx, "policy.current.name"),
      getAt(ctx, "outbound.name"),
      getAt(ctx, "profile.currentNode.name"),
      getAt(ctx, "profile.selectedNode.name"),
      findProxyNameInObject(ctx)
    )
  );

  const rawProtocol = clean(
    pick(
      getAt(ctx, "node.protocol"),
      getAt(ctx, "node.type"),
      getAt(ctx, "node.scheme"),
      getAt(ctx, "proxy.protocol"),
      getAt(ctx, "proxy.type"),
      getAt(ctx, "proxy.scheme"),
      getAt(ctx, "currentProxy.protocol"),
      getAt(ctx, "currentProxy.type"),
      getAt(ctx, "currentProxy.scheme"),
      getAt(ctx, "selectedProxy.protocol"),
      getAt(ctx, "selectedProxy.type"),
      getAt(ctx, "selectedProxy.scheme"),
      getAt(ctx, "selectedNode.protocol"),
      getAt(ctx, "selectedNode.type"),
      getAt(ctx, "selectedNode.scheme"),
      getAt(ctx, "policy.node.protocol"),
      getAt(ctx, "policy.node.type"),
      getAt(ctx, "policy.selected.protocol"),
      getAt(ctx, "policy.selected.type"),
      getAt(ctx, "policy.current.protocol"),
      getAt(ctx, "policy.current.type"),
      getAt(ctx, "outbound.protocol"),
      getAt(ctx, "outbound.type"),
      getAt(ctx, "outbound.scheme"),
      getAt(ctx, "profile.currentNode.protocol"),
      getAt(ctx, "profile.currentNode.type"),
      getAt(ctx, "profile.selectedNode.protocol"),
      getAt(ctx, "profile.selectedNode.type"),
      findProtocolInObject(ctx)
    )
  );

  const protocol =
    normalizeProxyProtocol(rawProtocol) ||
    normalizeProxyProtocol(proxyName);

  return {
    name: proxyName,
    protocol: protocol
  };
}

function findProtocolInObject(object) {
  const found = [];
  const seen = [];

  function walk(value, path, depth) {
    if (depth > 5) return;
    if (!value || typeof value !== "object") return;
    if (seen.indexOf(value) >= 0) return;

    seen.push(value);

    Object.keys(value).forEach(function (key) {
      const next = value[key];
      const nextPath = path ? path + "." + key : key;
      const lowerPath = nextPath.toLowerCase();

      if (typeof next === "string") {
        const protocol = normalizeProxyProtocol(next);

        if (
          protocol &&
          (
            lowerPath.includes("proxy") ||
            lowerPath.includes("node") ||
            lowerPath.includes("outbound") ||
            lowerPath.includes("policy") ||
            lowerPath.includes("protocol") ||
            lowerPath.includes("scheme")
          )
        ) {
          found.push(protocol);
        }
      } else if (next && typeof next === "object") {
        walk(next, nextPath, depth + 1);
      }
    });
  }

  walk(object, "", 0);

  return found[0] || "";
}

function findProxyNameInObject(object) {
  const found = [];
  const seen = [];

  function walk(value, path, depth) {
    if (depth > 5) return;
    if (!value || typeof value !== "object") return;
    if (seen.indexOf(value) >= 0) return;

    seen.push(value);

    Object.keys(value).forEach(function (key) {
      const next = value[key];
      const nextPath = path ? path + "." + key : key;
      const lowerPath = nextPath.toLowerCase();

      if (typeof next === "string") {
        if (
          isMeaningful(next) &&
          (
            lowerPath.includes("proxy") ||
            lowerPath.includes("node") ||
            lowerPath.includes("outbound") ||
            lowerPath.includes("policy")
          ) &&
          (
            lowerPath.includes("name") ||
            lowerPath.includes("title")
          )
        ) {
          found.push(next);
        }
      } else if (next && typeof next === "object") {
        walk(next, nextPath, depth + 1);
      }
    });
  }

  walk(object, "", 0);

  return found[0] || "";
}

function protocolFromXY(value) {
  const raw = clean(value);

  if (!raw) {
    return "";
  }

  return normalizeProxyProtocol(raw) || raw;
}

function normalizeProxyProtocol(value) {
  const raw = clean(value);
  const text = raw.toLowerCase();

  if (!text) {
    return "";
  }

  const normalized = text
    .replace(/[_\-]+/g, " ")
    .replace(/[()[\]{}|,;]+/g, " ");

  const checks = [
    [/vless/, "VLESS"],
    [/vmess/, "VMESS"],
    [/trojan/, "Trojan"],
    [/shadowsocks\s*r|ssr/, "SSR"],
    [/shadowsocks|(^|\s)ss($|\s)/, "SS"],
    [/hysteria\s*2|hy2/, "HY2"],
    [/hysteria/, "Hysteria"],
    [/tuic/, "TUIC"],
    [/snell/, "Snell"],
    [/any\s*tls|anytls/, "AnyTLS"],
    [/wireguard|(^|\s)wg($|\s)/, "WireGuard"],
    [/socks\s*5|socks5/, "SOCKS5"],
    [/socks/, "SOCKS"],
    [/http\s*2|h2/, "HTTP/2"],
    [/https/, "HTTPS"],
    [/http/, "HTTP"],
    [/ssh/, "SSH"],
    [/mieru/, "Mieru"],
    [/juicity/, "Juicity"],
    [/shadow\s*tls|shadowtls/, "ShadowTLS"],
    [/naive/, "Naive"],
    [/brook/, "Brook"]
  ];

  for (let index = 0; index < checks.length; index += 1) {
    if (checks[index][0].test(normalized)) {
      return checks[index][1];
    }
  }

  return "";
}

function parseExitSource(data, sourceName) {
  if (!data || typeof data !== "object") {
    return {};
  }

  const ip = clean(
    pick(
      data.ip,
      data.query,
      data.ip_address,
      getAt(data, "location.ip")
    )
  );

  if (!ip) {
    return {};
  }

  const isp = clean(
    pick(
      getAt(data, "company.name"),
      getAt(data, "connection.isp"),
      getAt(data, "connection.org"),
      getAt(data, "asn.name"),
      data.isp,
      data.org,
      data.organization,
      data.asname,
      data.as,
      "未知组织"
    )
  );

  const orgText = [
    isp,
    data.org,
    data.organization,
    data.as,
    data.asname,
    getAt(data, "company.name"),
    getAt(data, "asn.name"),
    getAt(data, "connection.org"),
    getAt(data, "connection.isp")
  ].join(" ");

  const cloud = cloudProviderFromText(orgText);

  const flags = {
    datacenter:
      truthy(
        pick(
          data.is_datacenter,
          data.hosting,
          getAt(data, "security.is_datacenter"),
          getAt(data, "company.is_datacenter")
        )
      ) || cloud.hit,

    hosting:
      truthy(
        pick(
          data.hosting,
          data.is_hosting,
          getAt(data, "security.is_hosting")
        )
      ) || cloud.hit,

    cloud: cloud.hit,

    proxy: truthy(
      pick(
        data.proxy,
        data.is_proxy,
        getAt(data, "security.is_proxy"),
        getAt(data, "security.proxy")
      )
    ),

    vpn: truthy(
      pick(
        data.is_vpn,
        getAt(data, "security.is_vpn"),
        getAt(data, "security.vpn")
      )
    ),

    tor: truthy(
      pick(
        data.is_tor,
        getAt(data, "security.is_tor"),
        getAt(data, "security.tor")
      )
    ),

    abuser: truthy(
      pick(
        data.is_abuser,
        getAt(data, "security.is_abuser")
      )
    ),

    mobile: truthy(
      pick(
        data.mobile,
        data.is_mobile,
        getAt(data, "connection.mobile")
      )
    ),

    residential: false,

    risk: numberOrNull(
      pick(
        data.risk,
        getAt(data, "security.risk"),
        getAt(data, "risk.score")
      )
    )
  };

  const rawType = clean(
    pick(
      getAt(data, "company.type"),
      getAt(data, "connection.type"),
      getAt(data, "asn.type")
    )
  ).toLowerCase();

  if (
    rawType.includes("isp") ||
    rawType.includes("residential") ||
    rawType.includes("broadband")
  ) {
    flags.residential = true;
  }

  if (
    rawType.includes("hosting") ||
    rawType.includes("datacenter") ||
    rawType.includes("cloud")
  ) {
    flags.datacenter = true;
    flags.hosting = true;
  }

  const rawCountry = clean(
    pick(
      getAt(data, "location.country"),
      data.country_name,
      data.country
    )
  );

  return {
    source: sourceName || "",
    ip: ip,
    city: clean(
      pick(
        getAt(data, "location.city"),
        data.city,
        getAt(data, "location.region"),
        data.regionName,
        data.region,
        "未知城市"
      )
    ),
    region: clean(
      pick(
        getAt(data, "location.region"),
        data.regionName,
        data.region
      )
    ),
    country:
      /^[A-Za-z]{2}$/.test(rawCountry)
        ? ""
        : rawCountry,
    countryCode: countryCode(
      pick(
        getAt(data, "location.country_code"),
        data.country_code,
        data.countryCode,
        /^[A-Za-z]{2}$/.test(rawCountry) ? rawCountry : ""
      )
    ),
    isp: cloud.name || isp,
    cloudProvider: cloud.name,
    kind: classifyExitKind(flags),
    flags: flags
  };
}

function parseProxyCheck(data, ip) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const target = clean(ip);
  const keys = Object.keys(data);
  const fallbackKey = keys.find(function (key) {
    return key !== "status" && key !== "message";
  });

  const item = data[target] || data[fallbackKey];

  if (!item || typeof item !== "object") {
    return null;
  }

  const typeText = clean(
    pick(
      item.type,
      item.proxy,
      item.provider,
      item.organisation,
      item.asn,
      item.operator
    )
  );

  const orgText = [
    item.provider,
    item.organisation,
    item.operator,
    item.asn,
    item.type
  ].join(" ");

  const cloud = cloudProviderFromText(orgText);

  const proxyValue = clean(item.proxy).toLowerCase();
  const typeLower = typeText.toLowerCase();

  const flags = {
    datacenter:
      cloud.hit ||
      typeLower.includes("hosting") ||
      typeLower.includes("server") ||
      typeLower.includes("business"),

    hosting:
      cloud.hit ||
      typeLower.includes("hosting") ||
      typeLower.includes("server"),

    cloud: cloud.hit,

    proxy:
      proxyValue === "yes" ||
      typeLower.includes("proxy"),

    vpn:
      typeLower.includes("vpn"),

    tor:
      typeLower.includes("tor"),

    abuser:
      typeLower.includes("abuse") ||
      typeLower.includes("blacklist") ||
      typeLower.includes("spam"),

    mobile:
      typeLower.includes("mobile"),

    residential:
      typeLower.includes("residential"),

    risk:
      numberOrNull(item.risk)
  };

  return {
    source: "proxycheck.io",
    ip: target,
    city: clean(item.city),
    region: clean(item.region),
    country: clean(item.country),
    countryCode: countryCode(item.isocode),
    isp: clean(
      pick(
        cloud.name,
        item.provider,
        item.organisation,
        item.operator,
        "未知组织"
      )
    ),
    cloudProvider: cloud.name,
    kind: classifyExitKind(flags),
    flags: flags
  };
}

function mergeExitSources(sources) {
  const valid = (sources || []).filter(function (item) {
    return item && item.ip;
  });

  if (valid.length === 0) {
    return {
      ip: "未识别",
      city: "出口检测失败",
      region: "",
      country: "",
      countryCode: "",
      isp: "未知组织",
      kind: "未知网络",
      flags: {}
    };
  }

  const primaryIP =
    mostCommon(
      valid.map(function (item) {
        return item.ip;
      })
    ) || valid[0].ip;

  const sameIP = valid.filter(function (item) {
    return item.ip === primaryIP;
  });

  const allText = sameIP
    .map(function (item) {
      return [item.isp, item.cloudProvider].join(" ");
    })
    .join(" ");

  const cloud = cloudProviderFromText(allText);

  const evidence = {
    sourceCount: sameIP.length,
    datacenterCount: 0,
    hostingCount: 0,
    cloudCount: cloud.hit ? 1 : 0,
    proxyCount: 0,
    vpnCount: 0,
    torCount: 0,
    abuserCount: 0,
    mobileCount: 0,
    residentialCount: 0,
    riskMax: null,
    riskCount: 0
  };

  sameIP.forEach(function (item) {
    const flags = item.flags || {};

    if (flags.datacenter) evidence.datacenterCount += 1;
    if (flags.hosting) evidence.hostingCount += 1;
    if (flags.cloud) evidence.cloudCount += 1;
    if (flags.proxy) evidence.proxyCount += 1;
    if (flags.vpn) evidence.vpnCount += 1;
    if (flags.tor) evidence.torCount += 1;
    if (flags.abuser) evidence.abuserCount += 1;
    if (flags.mobile) evidence.mobileCount += 1;
    if (flags.residential) evidence.residentialCount += 1;

    if (Number.isFinite(Number(flags.risk))) {
      evidence.riskCount += 1;
      evidence.riskMax = Math.max(
        Number(evidence.riskMax || 0),
        Number(flags.risk)
      );
    }
  });

  const mergedFlags = {
    datacenter: evidence.datacenterCount > 0,
    hosting: evidence.hostingCount > 0,
    cloud: evidence.cloudCount > 0,
    proxy: evidence.proxyCount > 0,
    vpn: evidence.vpnCount > 0,
    tor: evidence.torCount > 0,
    abuser: evidence.abuserCount > 0,
    mobile: evidence.mobileCount > 0,
    residential: evidence.residentialCount > 0,
    risk: evidence.riskMax,
    evidence: evidence
  };

  if (cloud.hit) {
    mergedFlags.datacenter = true;
    mergedFlags.hosting = true;
    mergedFlags.cloud = true;
    mergedFlags.residential = false;
  }

  const kind = classifyExitKind(mergedFlags);

  return {
    ip: primaryIP,
    city: bestField(sameIP, "city") || "未知城市",
    region: bestField(sameIP, "region"),
    country: bestField(sameIP, "country"),
    countryCode: countryCode(bestField(sameIP, "countryCode")),
    isp: cloud.name || bestField(sameIP, "isp") || "未知组织",
    cloudProvider: cloud.name,
    kind: kind,
    flags: mergedFlags,
    sources: sameIP
      .map(function (item) {
        return item.source;
      })
      .filter(Boolean)
  };
}

function classifyExitKind(flags) {
  const f = flags || {};

  if (f.mobile) {
    return "移动网络";
  }

  if (f.datacenter || f.hosting || f.cloud) {
    return "商业机房";
  }

  if (f.residential) {
    return "住宅 IP";
  }

  if (f.proxy || f.vpn) {
    return "住宅 IP";
  }

  return "未知网络";
}

function cloudProviderFromText(value) {
  const text = clean(value).toLowerCase();

  if (!text) {
    return {
      hit: false,
      name: ""
    };
  }

  const providers = [
    ["oracle", "Oracle"],
    ["oci", "Oracle"],
    ["amazon", "AWS"],
    ["aws", "AWS"],
    ["google cloud", "Google Cloud"],
    ["google llc", "Google"],
    ["microsoft", "Microsoft Azure"],
    ["azure", "Microsoft Azure"],
    ["digitalocean", "DigitalOcean"],
    ["vultr", "Vultr"],
    ["linode", "Akamai Linode"],
    ["akamai", "Akamai"],
    ["ovh", "OVH"],
    ["hetzner", "Hetzner"],
    ["leaseweb", "Leaseweb"],
    ["m247", "M247"],
    ["choopa", "Vultr"],
    ["contabo", "Contabo"],
    ["scaleway", "Scaleway"],
    ["hivelocity", "Hivelocity"],
    ["cloudflare", "Cloudflare"],
    ["tencent cloud", "Tencent Cloud"],
    ["alibaba cloud", "Alibaba Cloud"],
    ["aliyun", "Alibaba Cloud"],
    ["alicloud", "Alibaba Cloud"],
    ["huawei cloud", "Huawei Cloud"],
    ["volcengine", "Volcengine"],
    ["ucloud", "UCLOUD"],
    ["uccloud", "UCLOUD"]
  ];

  for (let index = 0; index < providers.length; index += 1) {
    if (matchesKeyword(text, providers[index][0])) {
      return {
        hit: true,
        name: providers[index][1]
      };
    }
  }

  return {
    hit: false,
    name: ""
  };
}

function mostCommon(values) {
  const count = {};
  let best = "";
  let bestCount = 0;

  values
    .map(clean)
    .filter(Boolean)
    .forEach(function (value) {
      count[value] = (count[value] || 0) + 1;

      if (count[value] > bestCount) {
        best = value;
        bestCount = count[value];
      }
    });

  return best;
}

function bestField(items, field) {
  const values = (items || [])
    .map(function (item) {
      return clean(item[field]);
    })
    .filter(function (value) {
      return value && value !== "未知城市" && value !== "未知组织";
    });

  return mostCommon(values) || values[0] || "";
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function parseLocalExit(data, forceLocalMainland) {
  if (!data || typeof data !== "object") {
    return {};
  }

  const ip = clean(
    pick(
      data.query,
      data.ip,
      data.ip_address,
      getAt(data, "location.ip")
    )
  );

  if (!ip) {
    return {};
  }

  const countryCodeValue = countryCode(
    pick(
      data.countryCode,
      data.country_code,
      getAt(data, "location.country_code")
    )
  );

  const country = clean(
    pick(
      data.country,
      data.country_name,
      getAt(data, "location.country")
    )
  );

  const region = clean(
    pick(
      data.regionName,
      data.region,
      getAt(data, "location.region")
    )
  );

  const city = clean(
    pick(
      data.city,
      getAt(data, "location.city")
    )
  );

  const isChina =
    countryCodeValue === "CN" ||
    country.includes("中国") ||
    forceLocalMainland;

  const label = isChina
    ? mainlandAreaLabel(region, city)
    : formatLocalArea(countryCodeValue, country, region, city);

  return {
    ip: ip,
    country: isChina ? "中国" : country,
    countryCode: isChina ? "CN" : countryCodeValue,
    region: region,
    city: city,
    isp: clean(pick(data.isp, data.org, data.organization)),
    org: clean(data.org),
    asname: clean(data.asname),
    as: clean(data.as),
    label: label
  };
}

function mainlandAreaLabel(region, city) {
  const label = formatLocalArea("CN", "中国", region, city);

  if (!label || label === "中国") {
    return "中国大陆";
  }

  return label;
}

function formatLocalArea(countryCodeValue, country, region, city) {
  const cc = countryCode(countryCodeValue);
  let r = clean(region);
  let c = clean(city);

  r = r
    .replace(/省$/g, "")
    .replace(/市$/g, "")
    .replace(/壮族自治区$/g, "")
    .replace(/回族自治区$/g, "")
    .replace(/维吾尔自治区$/g, "")
    .replace(/自治区$/g, "");

  c = c.replace(/市$/g, "");

  if (cc === "CN" || country.includes("中国")) {
    if (["北京", "上海", "天津", "重庆"].includes(r)) {
      return r;
    }

    if (r && c && r !== c) {
      return r + c;
    }

    return c || r || "中国";
  }

  if (c && r && c !== r) {
    return r + " " + c;
  }

  return c || r || country || "直连地区未知";
}

function providerFromText(value) {
  const text = clean(value).toLowerCase();

  if (!text) {
    return { full: "", short: "" };
  }

  if (text.includes("cloudflare")) return { full: "Cloudflare DNS", short: "CF" };
  if (text.includes("google")) return { full: "Google DNS", short: "谷歌" };
  if (text.includes("quad9")) return { full: "Quad9 DNS", short: "Q9" };
  if (text.includes("opendns") || text.includes("cisco")) return { full: "OpenDNS", short: "Open" };
  if (text.includes("adguard")) return { full: "AdGuard DNS", short: "AdG" };
  if (text.includes("nextdns")) return { full: "NextDNS", short: "Next" };
  if (text.includes("cleanbrowsing")) return { full: "CleanBrowsing DNS", short: "Clean" };
  if (text.includes("dns.sb")) return { full: "DNS.SB", short: "DNS.SB" };
  if (text.includes("mullvad")) return { full: "Mullvad DNS", short: "Mull" };
  if (text.includes("control d") || text.includes("controld")) return { full: "Control D DNS", short: "CtrlD" };

  if (
    text.includes("alidns") ||
    text.includes("alibaba") ||
    text.includes("aliyun") ||
    text.includes("alicloud") ||
    text.includes("alibaba cloud")
  ) {
    return { full: "AliDNS", short: "阿里" };
  }

  if (
    text.includes("dnspod") ||
    text.includes("tencent") ||
    text.includes("tencent cloud")
  ) {
    return { full: "DNSPod", short: "腾讯" };
  }

  if (
    text.includes("baidu") ||
    text.includes("baidudns")
  ) {
    return { full: "Baidu DNS", short: "百度" };
  }

  if (
    matchesKeyword(text, "360") ||
    text.includes("qihoo")
  ) {
    return { full: "360 DNS", short: "360" };
  }

  if (
    text.includes("114dns") ||
    text.includes("114 dns") ||
    text.includes("114.114")
  ) {
    return { full: "114DNS", short: "114" };
  }

  if (
    text.includes("chinanet") ||
    text.includes("china telecom") ||
    text.includes("telecom") ||
    matchesKeyword(text, "ctc") ||
    text.includes("中国电信") ||
    text.includes("电信")
  ) {
    return { full: "中国电信 DNS", short: "电信" };
  }

  if (
    text.includes("china mobile") ||
    text.includes("cmcc") ||
    text.includes("cmnet") ||
    matchesKeyword(text, "cmi") ||
    text.includes("中国移动") ||
    text.includes("移动")
  ) {
    return { full: "中国移动 DNS", short: "移动" };
  }

  if (
    text.includes("china unicom") ||
    text.includes("unicom") ||
    text.includes("cucc") ||
    text.includes("中国联通") ||
    text.includes("联通")
  ) {
    return { full: "中国联通 DNS", short: "联通" };
  }

  if (
    text.includes("cernet") ||
    text.includes("china education") ||
    text.includes("education network") ||
    text.includes("中国教育") ||
    text.includes("教育网")
  ) {
    return { full: "中国教育网 DNS", short: "教育" };
  }

  if (
    text.includes("great wall broadband") ||
    text.includes("gwbn") ||
    text.includes("长城宽带")
  ) {
    return { full: "长城宽带 DNS", short: "长宽" };
  }

  if (
    text.includes("drpeng") ||
    text.includes("鹏博士")
  ) {
    return { full: "鹏博士 DNS", short: "鹏博" };
  }

  return { full: "", short: "" };
}

function compactDNSProviderName(value) {
  const text = clean(value);

  if (!text) {
    return "未知";
  }

  const provider = providerFromText(text);

  if (provider.short) {
    return provider.short;
  }

  const lower = text.toLowerCase();

  if (lower.includes("telecom")) return "电信";
  if (lower.includes("mobile")) return "移动";
  if (lower.includes("unicom")) return "联通";
  if (lower.includes("education")) return "教育";
  if (lower.includes("cloudflare")) return "CF";
  if (lower.includes("google")) return "谷歌";
  if (lower.includes("oracle")) return "Oracle";
  if (lower.includes("amazon") || lower.includes("aws")) return "AWS";
  if (lower.includes("microsoft") || lower.includes("azure")) return "Azure";

  const cleaned = text
    .replace(/^as\d+\s*/i, "")
    .replace(/co\.,?\s*ltd\.?/ig, "")
    .replace(/company/ig, "")
    .replace(/limited/ig, "")
    .replace(/inc\.?/ig, "")
    .replace(/llc/ig, "")
    .replace(/corporation/ig, "")
    .replace(/network/ig, "")
    .replace(/communications?/ig, "")
    .replace(/internet/ig, "")
    .replace(/technology/ig, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "未知";
  }

  if (/[\u4e00-\u9fa5]/.test(cleaned)) {
    return cleaned.slice(0, 4);
  }

  const first = cleaned.split(/[ ,，/|()]+/).filter(Boolean)[0];

  if (!first) {
    return "未知";
  }

  return first.length > 6
    ? first.slice(0, 6)
    : first;
}

function chooseDNSProvider(baseDNS, verifiedDNS) {
  const base = baseDNS || {
    full: "",
    short: ""
  };

  const verified = verifiedDNS || {
    ok: false,
    full: "",
    short: "",
    ip: "",
    geo: "",
    isp: "",
    org: "",
    asname: "",
    as: ""
  };

  const verifiedProvider = providerFromText(
    [
      verified.full,
      verified.short,
      verified.geo,
      verified.ip,
      verified.isp,
      verified.org,
      verified.asname,
      verified.as
    ].join(" ")
  );

  if (verifiedProvider.short) {
    return verifiedProvider;
  }

  if (verified.ok && verified.short && !isWeakDNSLabel(verified.short)) {
    return {
      full: verified.full || verified.short,
      short: dnsTinyLabel(verified.short)
    };
  }

  const baseProvider = providerFromText(
    [
      base.full,
      base.short
    ].join(" ")
  );

  if (baseProvider.short) {
    return baseProvider;
  }

  if (base.short && !isWeakDNSLabel(base.short)) {
    return {
      full: base.full,
      short: dnsTinyLabel(base.short)
    };
  }

  if (verified.ok && verified.ip) {
    return {
      full: verified.ip,
      short: compactDNSProviderName(
        verified.isp ||
        verified.org ||
        verified.asname ||
        verified.as ||
        verified.geo ||
        verified.ip
      )
    };
  }

  return {
    full: "未知 DNS",
    short: "未知"
  };
}

function isWeakDNSLabel(value) {
  return [
    "",
    "系统",
    "网关",
    "自定义",
    "自定",
    "未知",
    "IPv6"
  ].includes(clean(value));
}

function dnsTinyLabel(value) {
  const name = clean(value);
  const provider = providerFromText(name);

  if (provider.short) {
    return provider.short;
  }

  const map = {
    "Cloudflare": "CF",
    "Cloudflare DNS": "CF",
    "CF": "CF",
    "Google": "谷歌",
    "Google DNS": "谷歌",
    "谷歌": "谷歌",
    "AliDNS": "阿里",
    "Ali": "阿里",
    "阿里": "阿里",
    "DNSPod": "腾讯",
    "Pod": "腾讯",
    "腾讯": "腾讯",
    "OpenDNS": "Open",
    "Open": "Open",
    "AdGuard": "AdG",
    "AdG": "AdG",
    "Quad9": "Q9",
    "Q9": "Q9",
    "114DNS": "114",
    "114": "114",
    "NextDNS": "Next",
    "Next": "Next",
    "中国电信 DNS": "电信",
    "电信": "电信",
    "中国移动 DNS": "移动",
    "移动": "移动",
    "中国联通 DNS": "联通",
    "联通": "联通",
    "中国教育网 DNS": "教育",
    "教育": "教育",
    "网关 DNS": "网关",
    "网关": "网关",
    "系统": "系统",
    "自定义": "自定",
    "自定": "自定",
    "未知": "未知",
    "IPv6": "IPv6"
  };

  if (map[name]) {
    return map[name];
  }

  if (name.length <= 4) {
    return name;
  }

  return "未知";
}

function purityScore(exit) {
  const flags = (exit && exit.flags) || {};
  const evidence = flags.evidence || {};
  const kind = clean(exit && exit.kind);

  let score;

  if (kind === "住宅 IP") {
    score = 92;
  } else if (kind === "移动网络") {
    score = 92;
  } else if (kind === "教育网络" || kind === "企业网络") {
    score = 88;
  } else if (kind === "商业机房") {
    score = 78;
  } else {
    score = 72;
  }

  const proxyCount = Number(evidence.proxyCount || 0);
  const vpnCount = Number(evidence.vpnCount || 0);
  const torCount = Number(evidence.torCount || 0);
  const abuserCount = Number(evidence.abuserCount || 0);
  const riskValue = Number(flags.risk);

  const proxyVpnEvidenceCount = proxyCount + vpnCount;

  if (torCount > 0 || flags.tor) {
    score -= 55;
  }

  if (abuserCount > 0 || flags.abuser) {
    score -= 35;
  }

  if (proxyVpnEvidenceCount >= 2) {
    score -= 30;
  } else if (proxyVpnEvidenceCount === 1) {
    score -= 16;
  }

  if (Number.isFinite(riskValue)) {
    if (riskValue >= 80) {
      score -= 25;
    } else if (riskValue >= 70) {
      score -= 20;
    } else if (riskValue >= 40) {
      score -= 10;
    } else if (riskValue >= 20) {
      score -= 4;
    }
  }

  if (kind === "商业机房" || flags.datacenter || flags.hosting || flags.cloud) {
    score -= 8;
  }

  if (
    kind === "住宅 IP" &&
    !flags.proxy &&
    !flags.vpn &&
    !flags.tor &&
    !flags.abuser
  ) {
    score += 3;
  }

  if (
    kind === "移动网络" &&
    !flags.proxy &&
    !flags.vpn &&
    !flags.tor &&
    !flags.abuser
  ) {
    score += 3;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score: score,
    risk: 100 - score,
    evidence: evidence
  };
}

function riskLevel(exit, purity) {
  const flags = (exit && exit.flags) || {};
  const evidence = flags.evidence || {};
  const score = Number(purity && purity.score);
  const riskValue = Number(flags.risk);

  const proxyVpnEvidenceCount =
    Number(evidence.proxyCount || 0) +
    Number(evidence.vpnCount || 0);

  if (
    flags.tor ||
    Number(evidence.torCount || 0) > 0 ||
    flags.abuser ||
    Number(evidence.abuserCount || 0) > 0 ||
    riskValue >= 85 ||
    score < 45 ||
    (
      proxyVpnEvidenceCount >= 2 &&
      (
        score < 60 ||
        riskValue >= 70
      )
    )
  ) {
    return "高风险";
  }

  if (
    score < 75 ||
    flags.datacenter ||
    flags.hosting ||
    flags.cloud ||
    proxyVpnEvidenceCount > 0 ||
    riskValue >= 40
  ) {
    return "中风险";
  }

  return "低风险";
}

function toneColor(tone, colors) {
  if (tone === "green") return colors.green;
  if (tone === "red") return colors.red;
  return colors.amber;
}

function parseIPv4(ip) {
  const parts = clean(ip).split(".");
  if (parts.length !== 4) return null;

  const values = parts.map(Number);

  if (
    values.some(function (value) {
      return !Number.isInteger(value) || value < 0 || value > 255;
    })
  ) {
    return null;
  }

  return values;
}

function isPrivateIPv4(ip) {
  const parts = parseIPv4(ip);
  if (!parts) return false;

  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function isCGNATIPv4(ip) {
  const parts = parseIPv4(ip);
  return Boolean(
    parts &&
    parts[0] === 100 &&
    parts[1] >= 64 &&
    parts[1] <= 127
  );
}

function isPublicIPv4(ip) {
  const parts = parseIPv4(ip);

  return Boolean(
    parts &&
    !isPrivateIPv4(ip) &&
    !isCGNATIPv4(ip) &&
    parts[0] !== 0 &&
    parts[0] !== 127 &&
    parts[0] < 224 &&
    !(parts[0] === 169 && parts[1] === 254)
  );
}

// 仅凭设备地址判断：无法做真正的 STUN NAT 类型探测
function detectNAT(localIP, hasIPv6) {
  if (isCGNATIPv4(localIP)) {
    return { label: "CGNAT", tone: "amber" };
  }

  if (isPublicIPv4(localIP)) {
    return { label: "公网", tone: "green" };
  }

  if (isPrivateIPv4(localIP)) {
    return { label: "NAT", tone: "amber" };
  }

  if (hasIPv6) {
    return { label: "IPv6", tone: "green" };
  }

  return { label: "未知", tone: "red" };
}

function detectDNSProvider(addresses) {
  const list = Array.isArray(addresses)
    ? addresses.map(clean).filter(Boolean)
    : [clean(addresses)].filter(Boolean);

  if (list.length === 0) {
    return {
      full: "系统 DNS",
      short: "系统"
    };
  }

  const providers = [
    {
      full: "Cloudflare DNS",
      short: "CF",
      values: [
        "1.1.1.1",
        "1.0.0.1",
        "2606:4700:4700::1111",
        "2606:4700:4700::1001",
        "2606:4700:4700::64",
        "2606:4700:4700::6400"
      ]
    },
    {
      full: "Google DNS",
      short: "谷歌",
      values: [
        "8.8.8.8",
        "8.8.4.4",
        "2001:4860:4860::8888",
        "2001:4860:4860::8844"
      ]
    },
    {
      full: "Quad9 DNS",
      short: "Q9",
      values: [
        "9.9.9.9",
        "149.112.112.112",
        "2620:fe::fe",
        "2620:fe::9"
      ]
    },
    {
      full: "OpenDNS",
      short: "Open",
      values: [
        "208.67.222.222",
        "208.67.220.220",
        "2620:119:35::35",
        "2620:119:53::53"
      ]
    },
    {
      full: "AdGuard DNS",
      short: "AdG",
      values: [
        "94.140.14.14",
        "94.140.15.15",
        "94.140.14.15",
        "94.140.15.16",
        "2a10:50c0::ad1:ff",
        "2a10:50c0::ad2:ff"
      ]
    },
    {
      full: "AliDNS",
      short: "阿里",
      values: [
        "223.5.5.5",
        "223.6.6.6",
        "2400:3200::1",
        "2400:3200:baba::1"
      ]
    },
    {
      full: "DNSPod",
      short: "腾讯",
      values: [
        "119.29.29.29",
        "119.28.28.28",
        "2402:4e00::"
      ]
    },
    {
      full: "114DNS",
      short: "114",
      values: [
        "114.114.114.114",
        "114.114.115.115",
        "240c::6666",
        "240c::6644"
      ]
    },
    {
      full: "NextDNS",
      short: "Next",
      values: [
        "45.90.28.",
        "45.90.30.",
        "2a07:a8c0:"
      ]
    }
  ];

  for (let i = 0; i < list.length; i += 1) {
    const raw = normalizeDNS(list[i]);

    for (let p = 0; p < providers.length; p += 1) {
      const provider = providers[p];

      for (let v = 0; v < provider.values.length; v += 1) {
        const value = provider.values[v].toLowerCase();

        if (raw === value || raw.startsWith(value)) {
          return provider;
        }
      }
    }
  }

  for (let i = 0; i < list.length; i += 1) {
    const raw = normalizeDNS(list[i]);

    if (
      raw.startsWith("fe80:") ||
      isPrivateIPv4(raw)
    ) {
      return {
        full: "本地网关 DNS",
        short: "网关"
      };
    }
  }

  return {
    full: "自定义 DNS",
    short: "自定义"
  };
}

function normalizeDNS(value) {
  return clean(value)
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/%.*$/, "");
}

function gatewayLabel(value) {
  const gateway = clean(value);
  if (!gateway || gateway === "未获取") return "—";
  return gateway;
}

function shortISP(value) {
  const isp = clean(value);

  if (!isp || isp === "未知组织") {
    return "未知";
  }

  if (isp.length <= 12) {
    return isp;
  }

  const words = isp.split(/\s+/);

  if (words.length > 1) {
    return words[0];
  }

  return isp.slice(0, 11) + "…";
}

function randomAlphaNum(length) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";

  for (let index = 0; index < length; index += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }

  return out;
}

function timeLabel(date) {
  return (
    String(date.getHours()).padStart(2, "0") +
    ":" +
    String(date.getMinutes()).padStart(2, "0")
  );
}

function dateLabel(date) {
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];

  return (
    String(date.getMonth() + 1).padStart(2, "0") +
    "/" +
    String(date.getDate()).padStart(2, "0") +
    " 周" +
    weekday
  );
}

function getScreenMetric(ctx, key) {
  const candidates = [
    getAt(ctx, "screen." + key),
    getAt(ctx, "device.screen." + key),
    getAt(ctx, "device.screenSize." + key)
  ];

  try {
    if (typeof screen !== "undefined" && screen && Number(screen[key]) > 0) {
      candidates.push(screen[key]);
    }
  } catch (_) {}

  for (let index = 0; index < candidates.length; index += 1) {
    const value = Number(candidates[index]);

    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return "";
}

function detectScheme(ctx) {
  const raw = clean(
    pick(
      ctx.colorScheme,
      ctx.appearance,
      ctx.theme,
      ctx.widgetColorScheme
    )
  ).toLowerCase();

  if (
    raw.includes("dark") ||
    raw.includes("深") ||
    raw === "2"
  ) {
    return "dark";
  }

  return "light";
}

function resolveAdaptiveColor(value, scheme) {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object") {
    return scheme === "dark"
      ? clean(value.dark) || clean(value.light)
      : clean(value.light) || clean(value.dark);
  }

  return "";
}

function clean(value) {
  return String(
    value === undefined || value === null ? "" : value
  ).trim();
}

function clamp(value, min, max) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.max(min, Math.min(max, number));
}

function numberInRange(value, min, max, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function pick() {
  for (let index = 0; index < arguments.length; index += 1) {
    const value = arguments[index];

    if (
      value !== undefined &&
      value !== null &&
      clean(value) !== ""
    ) {
      return value;
    }
  }

  return "";
}

function getAt(object, path) {
  const keys = String(path).split(".");
  let current = object;

  for (let index = 0; index < keys.length; index += 1) {
    if (
      !current ||
      typeof current !== "object" ||
      !(keys[index] in current)
    ) {
      return "";
    }

    current = current[keys[index]];
  }

  return current === undefined || current === null
    ? ""
    : current;
}

function truthy(value) {
  return value === true ||
    value === 1 ||
    ["true", "1", "yes", "y"].includes(
      clean(value).toLowerCase()
    );
}

function parseTrace(value) {
  const output = {};

  String(value || "")
    .split(/\r?\n/)
    .forEach(function (line) {
      const position = line.indexOf("=");

      if (position > 0) {
        output[line.slice(0, position).trim()] =
          line.slice(position + 1).trim();
      }
    });

  return output;
}

function countryCode(value) {
  const code = clean(value).toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}

function flag(value) {
  const code = countryCode(value);
  if (!code) return "";
  return (
    String.fromCodePoint(code.charCodeAt(0) + 127397) +
    String.fromCodePoint(code.charCodeAt(1) + 127397)
  );
}
function serviceState(status) {
  if (status >= 200 && status < 400) return "ok";
  if (status === 403 || status === 404 || status === 429 || status === 451) {
    return "limited";
  }
  if (status >= 400 && status < 500) return "ok";
  return "fail";
}

// 短关键词按单词边界匹配，避免 "oci" 命中 "Association" 这类误判
function matchesKeyword(text, key) {
  const lower = String(text || "").toLowerCase();
  if (key.length > 4) return lower.includes(key);
  return new RegExp("(^|[^a-z0-9])" + key + "([^a-z0-9]|$)").test(lower);
}
