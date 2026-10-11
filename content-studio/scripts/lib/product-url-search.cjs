/**
 * brand + productName から VC LinkSwitch 向け通常商品URLを探す。
 * - web: DuckDuckGo HTML（公式ドメイン優先。モールURLは採用しない）
 * - rakuten: チェーンに残っていてもスキップ（方針外）
 */

const {
  isVcLinkSwitchProductUrl,
  brandDomainHints,
  brandListingSeeds,
  isDeniedHost,
  hostnameOf,
} = require("./vc-linkswitch-url.cjs");

function buildSearchKeyword(brand, productName) {
  const b = String(brand || "").trim();
  const n = String(productName || "").trim();
  if (b && n) {
    if (n.includes(b)) return n;
    return `${b} ${n}`;
  }
  return n || b;
}

function normalizeMerchantUrl(raw) {
  let url = String(raw || "").trim();
  if (!url) return "";
  try {
    const u = new URL(url);
    if (/duckduckgo\.com$/i.test(u.hostname)) {
      const uddg = u.searchParams.get("uddg");
      if (uddg) {
        try {
          url = decodeURIComponent(uddg);
        } catch {
          url = uddg;
        }
      }
    }
  } catch {
    return "";
  }
  return url.trim();
}

/** @deprecated 互換用。VC判定に委譲 */
function isLikelyProductPageUrl(url, opts = {}) {
  return isVcLinkSwitchProductUrl(url, opts).ok;
}

function scoreCandidate(url, keyword, itemName = "", opts = {}) {
  const verdict = isVcLinkSwitchProductUrl(url, opts);
  if (!verdict.ok) return -1;

  let score = 0;
  const hay = `${itemName} ${url}`.toLowerCase();
  const tokens = String(keyword || "")
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  for (const t of tokens) {
    if (hay.includes(t.toLowerCase())) score += 3;
  }

  const host = hostnameOf(url);
  const hints = brandDomainHints(opts.brand);
  if (hints.some((d) => host === d || host.endsWith(`.${d}`))) {
    score += 12;
  } else {
    score += 4; // 許可ドメイン上だがブランドヒント外
  }

  if (/\/(products?|item|sku|goods|detail)\//i.test(verdict.path || "")) {
    score += 3;
  }
  return score;
}

function pickBestCandidate(candidates, keyword, opts = {}) {
  const minScore = Number(opts.minScore || 0);
  const ranked = candidates
    .map((c) => {
      const url = normalizeMerchantUrl(c.url);
      return {
        url,
        itemName: c.itemName || "",
        score: scoreCandidate(url, keyword, c.itemName || "", opts),
        source: c.source || "",
        verdict: isVcLinkSwitchProductUrl(url, opts),
      };
    })
    .filter((c) => c.url && c.score > 0 && c.score >= minScore && c.verdict.ok)
    .sort((a, b) => b.score - a.score);
  return ranked[0] || null;
}

async function defaultFetch(url, init) {
  if (typeof fetch !== "function") {
    throw new Error("fetch が使えません（Node 18+ が必要）");
  }
  return fetch(url, init);
}

async function fetchDuckDuckGoLinks(query, opts = {}) {
  const endpoint =
    opts.endpoint ||
    process.env.PRODUCT_URL_WEB_ENDPOINT ||
    "https://html.duckduckgo.com/html/";
  const fetchImpl = opts.fetchImpl || defaultFetch;
  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "content-studio-product-url-resolver/1.0",
    },
    body: new URLSearchParams({ q: query, kl: "jp-jp" }).toString(),
    signal: AbortSignal.timeout(Number(process.env.PRODUCT_URL_SEARCH_TIMEOUT_MS || 15000)),
  });
  const html = await res.text();
  const hrefs = [];
  const re = /href="(https?:\/\/[^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const normalized = normalizeMerchantUrl(m[1]);
    if (normalized) hrefs.push(normalized);
  }
  const reUddg = /uddg=([^&"]+)/gi;
  while ((m = reUddg.exec(html)) !== null) {
    try {
      hrefs.push(decodeURIComponent(m[1]));
    } catch {
      /* ignore */
    }
  }
  return {
    httpStatus: res.status,
    // 202 等でもリンクが取れていれば使う（DDGのレート制御対策）
    ok: res.ok || hrefs.length > 0,
    links: [...new Set(hrefs)],
    bodyPreview: html.slice(0, 240),
    endpoint,
    query,
  };
}

function absoluteUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return "";
  }
}

function tokensOf(keyword) {
  return String(keyword || "")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/**
 * 公式サイトHTMLから商品名に近い通常URLを抽出
 */
function extractOfficialCandidates(html, baseUrl, keyword, brand) {
  const out = [];
  const tokens = tokensOf(keyword);
  // <a href="...">...</a> をざっくり舐める
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = absoluteUrl(m[1], baseUrl);
    if (!href) continue;
    const text = String(m[2] || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const context = html.slice(Math.max(0, m.index - 120), m.index + m[0].length + 120);
    const hay = `${text} ${context}`.replace(/<[^>]+>/g, " ");
    const hitTokens = tokens.filter((t) => hay.includes(t));
    if (hitTokens.length === 0) continue;
    const verdict = isVcLinkSwitchProductUrl(href, { brand });
    if (!verdict.ok) continue;
    out.push({
      url: href,
      itemName: text.slice(0, 120),
      source: "official",
      tokenHits: hitTokens.length,
    });
  }
  return out;
}

/**
 * 公式ブティックを直接辿る（モール非経由・VC LinkSwitch前提）
 */
async function searchOfficial(keyword, opts = {}) {
  const brand = opts.brand || "";
  const detail = {
    provider: "official",
    keyword,
    brand,
    policy: "vc-linkswitch",
  };
  const seeds = brandListingSeeds(brand);
  if (seeds.length === 0) {
    return {
      ok: false,
      url: null,
      detail: { ...detail, error: "brandListingSeeds が未設定", seeds: [] },
    };
  }

  const fetchImpl = opts.fetchImpl || defaultFetch;
  const pageLogs = [];
  const candidates = [];

  for (const seed of seeds) {
    try {
      const res = await fetchImpl(seed, {
        headers: {
          "User-Agent": "content-studio-product-url-resolver/1.0",
          Accept: "text/html",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(
          Number(process.env.PRODUCT_URL_SEARCH_TIMEOUT_MS || 15000),
        ),
      });
      const html = await res.text();
      const finalUrl = res.url || seed;
      pageLogs.push({
        seed,
        httpStatus: res.status,
        finalUrl,
        htmlLen: html.length,
      });
      if (!res.ok && html.length < 1000) continue;
      candidates.push(...extractOfficialCandidates(html, finalUrl, keyword, brand));
    } catch (e) {
      pageLogs.push({ seed, error: `network: ${e.message || e}` });
    }
  }

  detail.pages = pageLogs;
  detail.candidateCount = candidates.length;

  // tokenHits 多め優先 + VCスコア
  const ranked = candidates
    .map((c) => ({
      ...c,
      score:
        scoreCandidate(c.url, keyword, c.itemName, { brand }) + c.tokenHits * 2,
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  detail.top = ranked.slice(0, 5).map((c) => ({
    url: c.url,
    score: c.score,
    itemName: c.itemName,
  }));

  if (!ranked[0]) {
    return {
      ok: false,
      url: null,
      detail: {
        ...detail,
        error: "公式サイトから商品名に一致する通常URLを見つけられなかった",
      },
    };
  }

  return {
    ok: true,
    url: ranked[0].url,
    itemName: ranked[0].itemName,
    detail: {
      ...detail,
      chosenScore: ranked[0].score,
      chosenHost: hostnameOf(ranked[0].url),
    },
  };
}

/**
 * VC許可ドメインの通常商品URLだけを採用（webフォールバック）
 */
async function searchWeb(keyword, opts = {}) {
  const brand = opts.brand || "";
  const detail = {
    provider: "web",
    keyword,
    brand,
    policy: "vc-linkswitch",
  };
  if (!keyword || keyword.length < 2) {
    return { ok: false, url: null, detail: { ...detail, error: "keyword が短すぎます" } };
  }

  const hints = brandDomainHints(brand);
  const queries = [`${keyword} 公式`, `${keyword} 公式サイト 商品`];
  for (const domain of hints) {
    queries.push(`site:${domain} ${keyword}`);
  }

  const allLinks = [];
  const queryLogs = [];
  for (const q of queries) {
    try {
      const got = await fetchDuckDuckGoLinks(q, opts);
      queryLogs.push({
        query: q,
        httpStatus: got.httpStatus,
        linkCount: got.links.length,
        endpoint: got.endpoint,
      });
      if (!got.ok) continue;
      allLinks.push(...got.links);
    } catch (e) {
      queryLogs.push({ query: q, error: `network: ${e.message || e}` });
    }
  }

  const uniq = [...new Set(allLinks)];
  detail.queries = queryLogs;
  detail.linkCount = uniq.length;
  detail.deniedSamples = uniq
    .filter((u) => isDeniedHost(hostnameOf(u)))
    .slice(0, 5);
  detail.allowedCandidates = uniq
    .filter((u) => isVcLinkSwitchProductUrl(u, { brand }).ok)
    .slice(0, 8);

  const candidates = uniq.map((url) => ({ url, itemName: "", source: "web" }));
  const best = pickBestCandidate(candidates, keyword, {
    minScore: 4,
    brand,
  });
  if (!best) {
    return {
      ok: false,
      url: null,
      detail: {
        ...detail,
        error:
          "VC許可ドメインの通常商品URLが見つからなかった（モールURLは採用しない）",
        sampleLinks: uniq.slice(0, 8),
      },
    };
  }

  return {
    ok: true,
    url: best.url,
    detail: {
      ...detail,
      chosenScore: best.score,
      chosenHost: hostnameOf(best.url),
    },
  };
}

async function searchProductPageUrl(keyword, opts = {}) {
  const rawChain = String(
    opts.chain || process.env.PRODUCT_URL_SEARCH_CHAIN || "official,web",
  )
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const chain = [];
  const skipped = [];
  for (const name of rawChain) {
    if (name === "rakuten") {
      skipped.push({
        provider: "rakuten",
        skipped: true,
        reason: "VC LinkSwitch方針のためモール検索(rakuten)は無効",
      });
      continue;
    }
    chain.push(name);
  }
  if (chain.length === 0) chain.push("official", "web");

  const steps = [...skipped];
  for (const name of chain) {
    let result;
    if (name === "official") {
      result = await searchOfficial(keyword, opts);
    } else if (name === "web") {
      result = await searchWeb(keyword, opts);
    } else {
      steps.push({ provider: name, error: "unknown provider" });
      continue;
    }
    steps.push(result.detail || { provider: name });
    if (result.ok && result.url) {
      const verdict = isVcLinkSwitchProductUrl(result.url, { brand: opts.brand });
      if (!verdict.ok) {
        steps.push({
          provider: name,
          rejectedAfterResolve: true,
          url: result.url,
          reason: verdict.reason,
        });
        continue;
      }
      return {
        ok: true,
        url: result.url,
        source: name,
        itemName: result.itemName || "",
        detail: { keyword, brand: opts.brand || "", steps, chosen: result.detail },
      };
    }
  }

  return {
    ok: false,
    url: null,
    source: "none",
    detail: {
      keyword,
      brand: opts.brand || "",
      steps,
      error: "検索チェーンで VC許可の通常商品URLを取得できなかった",
    },
  };
}

module.exports = {
  buildSearchKeyword,
  normalizeMerchantUrl,
  isLikelyProductPageUrl,
  scoreCandidate,
  pickBestCandidate,
  searchOfficial,
  searchWeb,
  searchProductPageUrl,
  extractOfficialCandidates,
};
