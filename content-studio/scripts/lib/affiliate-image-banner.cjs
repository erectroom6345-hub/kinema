/**
 * ブログ用アフィリエイト画像バナーHTML。
 * 画像全体がリンクになり、下に名前・価格・CTAを置く。
 */

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 楽天サムネの _ex=128x128 などを大きくする。
 * @param {string} imageUrl
 * @param {number} [size=300]
 */
function enlargeProductImage(imageUrl, size = 300) {
  const raw = String(imageUrl || "").trim();
  if (!raw) return "";
  const dim = Math.max(128, Math.min(1000, Number(size) || 300));
  try {
    const u = new URL(raw);
    if (/thumbnail\.image\.rakuten\.co\.jp/i.test(u.hostname)) {
      u.searchParams.set("_ex", `${dim}x${dim}`);
      return u.toString();
    }
  } catch {
    // fall through
  }
  return raw.replace(/([?&]_ex=)\d+x\d+/i, `$1${dim}x${dim}`);
}

/**
 * @param {{
 *   name?: string,
 *   url?: string,
 *   imageUrl?: string,
 *   priceRange?: string,
 *   productId?: string,
 *   className?: string,
 * }} opts
 */
function buildAffiliateImageBanner(opts = {}) {
  const name = String(opts.name || "商品").trim() || "商品";
  const url = String(opts.url || "").trim();
  const imageUrl = enlargeProductImage(opts.imageUrl || "", 300);
  const price = String(opts.priceRange || "").trim();
  const id = String(opts.productId || "").trim();
  const className = String(opts.className || "affiliate-banner").trim();
  const priceBit = price ? `<span style="display:block;margin-top:0.25em;color:#555;font-size:0.92em;">目安 ${escapeHtml(price)}</span>` : "";
  const dataAttr = id ? ` data-product-id="${escapeHtml(id)}"` : "";

  if (!url) {
    const img = imageUrl
      ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)}" style="max-width:100%;width:300px;height:auto;border:0;border-radius:6px;display:block;margin:0 auto;" />`
      : "";
    return [
      `<div class="${escapeHtml(className)}"${dataAttr} style="margin:1.25em 0;text-align:center;">`,
      img,
      `<p style="margin:0.6em 0 0;">${escapeHtml(name)}${priceBit}</p>`,
      `</div>`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const img = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)}" style="max-width:100%;width:300px;height:auto;border:0;border-radius:6px;display:block;margin:0 auto;" />`
    : `<span style="display:inline-block;padding:2.5em 1.5em;background:#f3f3f3;border-radius:6px;color:#666;">${escapeHtml(name)}</span>`;

  return [
    `<div class="${escapeHtml(className)}"${dataAttr} style="margin:1.25em 0;text-align:center;">`,
    `<a href="${escapeHtml(url)}" rel="nofollow sponsored noopener" target="_blank" style="display:inline-block;text-decoration:none;color:inherit;">`,
    img,
    `<span style="display:block;margin-top:0.6em;font-weight:600;">${escapeHtml(name)}</span>`,
    priceBit,
    `<span style="display:inline-block;margin-top:0.55em;padding:0.45em 1em;background:#bf0000;color:#fff;border-radius:4px;font-size:0.92em;">楽天で見る</span>`,
    `</a>`,
    `</div>`,
  ].join("\n");
}

module.exports = {
  escapeHtml,
  enlargeProductImage,
  buildAffiliateImageBanner,
};
