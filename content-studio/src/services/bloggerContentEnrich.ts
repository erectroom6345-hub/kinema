/**
 * Blogger本文への商品画像・商品ページリンク挿入（VC LinkSwitch向け通常URL）。
 * publishBeautyBlogger / backfill で共有する。
 */
import {
  appendUtmParams,
  formatUtmDate,
  sanitizeUtmToken,
} from "../utils/utm.ts";

/** VC LinkSwitch方針: モールURLは本文リンクに使わない（living の楽天は allowRakuten で例外） */
export function isDeniedMallHost(host: string): boolean {
  const h = (host || "").toLowerCase();
  const denied = [
    "rakuten.co.jp",
    "rakuten.com",
    "amazon.co.jp",
    "amazon.com",
    "shopping.yahoo.co.jp",
    "lohaco.jp",
    "lohaco.com",
    "qoo10.jp",
    "wowma.jp",
  ];
  return denied.some((s) => h === s || h.endsWith(`.${s}`));
}

export function isRakutenHost(host: string): boolean {
  const h = (host || "").toLowerCase();
  return h === "rakuten.co.jp" || h.endsWith(".rakuten.co.jp") || h === "rakuten.com" || h.endsWith(".rakuten.com");
}

export function isUsableAffiliateUrl(
  url: string,
  opts?: { allowRakuten?: boolean },
): boolean {
  const raw = (url || "").trim();
  if (!raw) return false;
  if (/example\.com(\/|$)/i.test(raw) || /YOURBLOG|REPLACE-|placeholder/i.test(raw)) {
    return false;
  }
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (isDeniedMallHost(u.hostname)) {
      if (opts?.allowRakuten && isRakutenHost(u.hostname)) return true;
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function isUsableImageUrl(url: string): boolean {
  const raw = (url || "").trim();
  if (!raw) return false;
  if (/example\.com(\/|$)/i.test(raw) || /YOURBLOG|REPLACE-|placeholder/i.test(raw)) {
    return false;
  }
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildAffiliateTrackUrl(
  productUrl: string,
  productId: string,
  opts?: { genre?: string },
): string {
  const id = sanitizeUtmToken(productId || "unknown");
  const genre =
    (opts?.genre || "").trim().toLowerCase() === "living" ? "living" : "beauty";
  return appendUtmParams(productUrl, {
    utm_source: "blogger",
    utm_medium: "affiliate",
    utm_campaign: `${genre}_${id}`,
    utm_content: `blog_${formatUtmDate()}`,
  });
}

/** 本文に商品導線リンクが既にあるか（後追い更新のスキップ判定） */
export function hasAffiliateProductLink(html: string): boolean {
  const raw = html || "";
  if (/商品の詳細・購入はこちら/.test(raw)) return true;
  if (/utm_medium=affiliate/i.test(raw)) return true;
  if (/商品ページを見る/.test(raw) && /rel=["'][^"']*sponsored/i.test(raw)) {
    return true;
  }
  return false;
}

export function buildAffiliateLinkBlock(opts: {
  productId: string;
  productName: string;
  productUrl: string;
  affiliateNote?: string;
  /** living は楽天URLを許可 */
  allowRakuten?: boolean;
  genre?: string;
}): { html: string; trackedUrl: string } | null {
  if (!isUsableAffiliateUrl(opts.productUrl, { allowRakuten: opts.allowRakuten })) {
    return null;
  }
  const name = (opts.productName || "商品").trim() || "商品";
  const tracked = buildAffiliateTrackUrl(opts.productUrl, opts.productId, {
    genre: opts.genre,
  });
  const linkBlock =
    `\n<hr />\n` +
    `<p><strong>商品の詳細・購入はこちら</strong><br />\n` +
    `<a href="${escapeHtml(tracked)}" rel="nofollow sponsored noopener" target="_blank">` +
    `${escapeHtml(name)} の商品ページを見る</a></p>`;
  const note = (opts.affiliateNote || "").trim();
  const noteBlock = note ? `\n<p><em>${escapeHtml(note)}</em></p>` : "";
  return { html: `${linkBlock}${noteBlock}`, trackedUrl: tracked };
}

/**
 * 公開HTMLに商品画像1枚 + アフィリエイトリンクを足す。
 */
export function enrichContentHtml(
  html: string,
  opts: {
    productId: string;
    productName: string;
    productUrl: string;
    imageUrl: string;
    affiliateNote?: string;
    allowRakuten?: boolean;
    genre?: string;
    /** カタログ内の共有固定画像URL（これらは商品画像として挿入しない） */
    sharedCatalogUrls?: string[];
  },
): string {
  let out = (html || "").trim();
  const name = (opts.productName || "商品").trim() || "商品";

  const shared = opts.sharedCatalogUrls || [];
  const imageUrl = (opts.imageUrl || "").trim();
  if (
    isUsableImageUrl(imageUrl) &&
    !isFixedSharedImageUrl(imageUrl, shared)
  ) {
    const imgBlock = buildProductImageBlock(imageUrl, name);
    if (/※本記事にはPRを含みます。/.test(out)) {
      out = out.replace(
        /(※本記事にはPRを含みます。(?:<\/p>)?)/,
        `$1\n${imgBlock}`,
      );
    } else if (/<\/p>/i.test(out)) {
      out = out.replace(/<\/p>/i, `</p>\n${imgBlock}`);
    } else {
      out = `${imgBlock}\n${out}`;
    }
    console.log(`Blogger本文に商品画像を1枚挿入: ${imageUrl}`);
  } else if (imageUrl && isFixedSharedImageUrl(imageUrl, shared)) {
    console.warn(
      `WARN: 固定共有画像のため商品画像挿入スキップ（画像0件扱い）: ${imageUrl}`,
    );
  } else {
    console.warn(
      `WARN: 商品画像URLが無い/仮値のため画像挿入スキップ（画像0件）: ${imageUrl || "(空)"}`,
    );
  }

  const link = buildAffiliateLinkBlock(opts);
  if (link) {
    if (!out.includes(link.trackedUrl) && !out.includes(opts.productUrl.trim())) {
      out = `${out}${link.html}`;
    }
    console.log(`Blogger本文にアフィリエイトリンクを挿入: ${link.trackedUrl}`);
  } else {
    console.warn(
      `アフィリエイトURLが無い/仮値(example.com等)のためリンク挿入スキップ: ${opts.productUrl || "(空)"}` +
        (opts.allowRakuten
          ? ` → products-living.json の rakutenUrl に本番リンクを入れてください`
          : ` → products-beauty.json の productUrl に本番リンクを入れてください`),
    );
  }

  return out;
}

/** リンク未挿入の既存本文へ、商品ページリンクだけ追記する */
export function appendAffiliateLinkOnly(
  html: string,
  opts: {
    productId: string;
    productName: string;
    productUrl: string;
    affiliateNote?: string;
  },
): { html: string; trackedUrl: string; changed: boolean } {
  const before = (html || "").trim();
  if (hasAffiliateProductLink(before)) {
    return { html: before, trackedUrl: "", changed: false };
  }
  const link = buildAffiliateLinkBlock(opts);
  if (!link) {
    return { html: before, trackedUrl: "", changed: false };
  }
  if (before.includes(link.trackedUrl) || before.includes(opts.productUrl.trim())) {
    return { html: before, trackedUrl: link.trackedUrl, changed: false };
  }
  return {
    html: `${before}${link.html}`,
    trackedUrl: link.trackedUrl,
    changed: true,
  };
}

/** カタログ全体で共有されている固定画像・ファイル名パターン */
const FIXED_IMAGE_NAME_RE =
  /instagram-post-01\.(jpe?g|png|webp)|instagram-fixed|beauty-fixed/i;

export function isFixedSharedImageUrl(
  url: string,
  sharedCatalogUrls: string[] = [],
): boolean {
  const raw = (url || "").trim();
  if (!raw) return false;
  if (FIXED_IMAGE_NAME_RE.test(raw)) return true;
  const key = normalizeImageKey(raw);
  for (const shared of sharedCatalogUrls) {
    if (shared && normalizeImageKey(shared) === key) return true;
  }
  return false;
}

export function normalizeImageKey(url: string): string {
  try {
    const u = new URL(url.trim());
    return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
  } catch {
    return (url || "").trim().replace(/\/+$/, "");
  }
}

export function extractImageSrcs(html: string): string[] {
  const out: string[] = [];
  const re = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html || "")) !== null) {
    if (m[1]) out.push(m[1].trim());
  }
  return out;
}

export function hasFixedSharedImage(
  html: string,
  sharedCatalogUrls: string[] = [],
): boolean {
  return extractImageSrcs(html).some((src) =>
    isFixedSharedImageUrl(src, sharedCatalogUrls),
  );
}

/** 固定画像以外の img があれば「すでに商品画像」とみなす */
export function hasNonFixedProductImage(
  html: string,
  sharedCatalogUrls: string[] = [],
): boolean {
  const srcs = extractImageSrcs(html);
  if (srcs.length === 0) return false;
  return srcs.some((src) => !isFixedSharedImageUrl(src, sharedCatalogUrls));
}

export function buildProductImageBlock(
  imageUrl: string,
  productName: string,
): string {
  const name = (productName || "商品").trim() || "商品";
  return (
    `<figure class="product-image" style="margin:1.25em 0;text-align:center">` +
    `<img src="${escapeHtml(imageUrl.trim())}" alt="${escapeHtml(name)}" ` +
    `style="max-width:100%;height:auto;border:0" />` +
    `</figure>`
  );
}

/**
 * 固定画像を商品画像へ置換。無ければ挿入。
 * すでに非固定画像がある場合は画像は触らない。
 */
export function replaceOrInsertProductImage(
  html: string,
  opts: {
    productImageUrl: string;
    productName: string;
    sharedCatalogUrls?: string[];
  },
): {
  html: string;
  imageAction: "replaced" | "inserted" | "kept-product" | "skipped-no-image";
  beforeSrcs: string[];
  afterSrc?: string;
} {
  const shared = opts.sharedCatalogUrls || [];
  const before = (html || "").trim();
  const beforeSrcs = extractImageSrcs(before);
  const productImageUrl = (opts.productImageUrl || "").trim();

  if (!isUsableImageUrl(productImageUrl) || isFixedSharedImageUrl(productImageUrl, shared)) {
    return {
      html: before,
      imageAction: "skipped-no-image",
      beforeSrcs,
    };
  }

  if (hasNonFixedProductImage(before, shared)) {
    return {
      html: before,
      imageAction: "kept-product",
      beforeSrcs,
      afterSrc: beforeSrcs.find((s) => !isFixedSharedImageUrl(s, shared)),
    };
  }

  let out = before;
  let replaced = false;
  out = out.replace(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, (full, src: string) => {
    if (!isFixedSharedImageUrl(src, shared)) return full;
    replaced = true;
    return `<img src="${escapeHtml(productImageUrl)}" alt="${escapeHtml((opts.productName || "商品").trim() || "商品")}" style="max-width:100%;height:auto;border:0" />`;
  });

  if (replaced) {
    return {
      html: out,
      imageAction: "replaced",
      beforeSrcs,
      afterSrc: productImageUrl,
    };
  }

  // 画像が無い → 商品画像ブロックを挿入
  const block = buildProductImageBlock(productImageUrl, opts.productName);
  if (/※本記事にはPRを含みます。/.test(out)) {
    out = out.replace(
      /(※本記事にはPRを含みます。(?:<\/p>)?)/,
      `$1\n${block}`,
    );
  } else if (/<\/p>/i.test(out)) {
    out = out.replace(/<\/p>/i, `</p>\n${block}`);
  } else {
    out = `${block}\n${out}`;
  }
  return {
    html: out,
    imageAction: "inserted",
    beforeSrcs,
    afterSrc: productImageUrl,
  };
}

/** 公式商品ページから商品画像URLを推定（OG汎用画像は避ける） */
export async function fetchProductImageFromPage(
  pageUrl: string,
  opts?: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<{ url: string; source: string } | null> {
  const fetchImpl = opts?.fetchImpl || fetch;
  const timeoutMs = opts?.timeoutMs || 15000;
  let res: Response;
  let html: string;
  try {
    res = await fetchImpl(pageUrl, {
      headers: {
        "User-Agent": "content-studio-product-image/1.0",
        Accept: "text/html",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    html = await res.text();
  } catch {
    return null;
  }
  if (!res.ok || !html) return null;

  const base = res.url || pageUrl;
  const abs = (href: string) => {
    try {
      return new URL(href, base).toString();
    } catch {
      return "";
    }
  };

  const candidates: Array<{ url: string; score: number; source: string }> = [];

  // Decorte系: /img/goods/L/CODE.png を最優先
  for (const m of html.matchAll(/\/img\/goods\/(L|S|1|2)\/([^"' )]+)/gi)) {
    const size = (m[1] || "").toUpperCase();
    const file = m[2] || "";
    const url = abs(`/img/goods/${m[1]}/${file}`);
    if (!url || !isUsableImageUrl(url)) continue;
    let score = 5;
    if (size === "L") score = 12;
    else if (size === "S") score = 10;
    else if (size === "1") score = 8;
    candidates.push({ url, score, source: `goods/${size}` });
  }

  const ogMatches = [
    ...html.matchAll(
      /property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/gi,
    ),
    ...html.matchAll(
      /content=["']([^"']+)["'][^>]*property=["']og:image(?::secure_url)?["']/gi,
    ),
  ];
  for (const m of ogMatches) {
    const raw = String(m[1] || "")
      .replace(/&amp;/gi, "&")
      .replace(/&#x3d;/gi, "=")
      .replace(/&#61;/g, "=");
    const url = abs(raw);
    if (!url || !isUsableImageUrl(url)) continue;
    // サイト共通 OGP は避ける
    if (
      /\/ogp\.(jpe?g|png|webp)$/i.test(url) ||
      /resources\/images\/ogp/i.test(url) ||
      /brand-opengraph/i.test(url) ||
      /\/item\/img\/top\//i.test(url)
    ) {
      continue;
    }
    let score = 7;
    if (/\/product\//i.test(url)) score = 11;
    candidates.push({ url, score, source: "og:image" });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return null;
  return { url: best.url, source: best.source };
}

/**
 * 商品画像URLを決める。
 * 1) catalog imageUrl（固定画像でなければ）
 * 2) 公式商品ページからの抽出
 */
export async function resolveProductImageForBackfill(opts: {
  catalogImageUrl?: string;
  productPageUrl?: string;
  sharedCatalogUrls?: string[];
}): Promise<{ url: string; source: string } | null> {
  const shared = opts.sharedCatalogUrls || [];
  const catalog = (opts.catalogImageUrl || "").trim();
  if (
    isUsableImageUrl(catalog) &&
    !isFixedSharedImageUrl(catalog, shared)
  ) {
    return { url: catalog, source: "catalog.imageUrl" };
  }

  const pageUrl = (opts.productPageUrl || "").trim();
  if (pageUrl && isUsableAffiliateUrl(pageUrl)) {
    const scraped = await fetchProductImageFromPage(pageUrl);
    if (scraped && !isFixedSharedImageUrl(scraped.url, shared)) {
      return scraped;
    }
  }

  return null;
}

/** カタログ内で複数商品が共有している imageUrl を「固定画像」扱いする */
export function collectSharedCatalogImageUrls(
  imageUrls: string[],
  minShared = 2,
): string[] {
  const counts = new Map<string, { url: string; n: number }>();
  for (const raw of imageUrls) {
    const url = (raw || "").trim();
    if (!url) continue;
    const key = normalizeImageKey(url);
    const prev = counts.get(key);
    if (prev) prev.n += 1;
    else counts.set(key, { url, n: 1 });
  }
  return [...counts.values()]
    .filter((v) => v.n >= minShared || FIXED_IMAGE_NAME_RE.test(v.url))
    .map((v) => v.url);
}
