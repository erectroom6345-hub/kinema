#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  isUsableProductUrl,
  resolveProductPageUrl,
  writeBackProductUrl,
  writeBackUrlMap,
} = require("./lib/resolve-product-url.cjs");
const {
  buildSearchKeyword,
  pickBestCandidate,
  normalizeMerchantUrl,
} = require("./lib/product-url-search.cjs");
const {
  isVcLinkSwitchProductUrl,
  isDeniedHost,
  describePolicy,
} = require("./lib/vc-linkswitch-url.cjs");

function tmpJson(name, data) {
  const p = path.join(
    os.tmpdir(),
    `cs-resolve-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
  return p;
}

async function main() {
  const policy = describePolicy();
  assert.ok(policy.allowedHostSuffixes.includes("cosmedecorte.com"));
  assert.ok(policy.deniedMallHostSuffixes.includes("rakuten.co.jp"));
  assert.ok(policy.deniedMallHostSuffixes.includes("amazon.co.jp"));

  assert.strictEqual(isUsableProductUrl(""), false);
  assert.strictEqual(isUsableProductUrl("https://example.com/x"), false);
  assert.strictEqual(
    isUsableProductUrl("https://item.rakuten.co.jp/shop/x/", {
      brand: "コスメデコルテ",
    }),
    false,
  );
  assert.strictEqual(
    isUsableProductUrl("https://www.amazon.co.jp/dp/B000000000", {
      brand: "コスメデコルテ",
    }),
    false,
  );
  assert.strictEqual(
    isUsableProductUrl("https://www.cosmedecorte.com/product/cosme_decorte/TEST", {
      brand: "コスメデコルテ",
    }),
    true,
  );

  assert.ok(isDeniedHost("item.rakuten.co.jp"));
  assert.ok(isDeniedHost("www.amazon.co.jp"));
  assert.strictEqual(
    isVcLinkSwitchProductUrl("https://www.cosmedecorte.com/basemakeup/line").ok,
    true,
  );

  assert.strictEqual(
    buildSearchKeyword("コスメデコルテ", "コスメデコルテ ザ スキン"),
    "コスメデコルテ ザ スキン",
  );

  {
    const best = pickBestCandidate(
      [
        {
          url: "https://item.rakuten.co.jp/shop/decorte-foundation/",
          itemName: "コスメデコルテ ザ スキン ミニマリスト",
        },
        {
          url: "https://www.amazon.co.jp/dp/B00TEST",
          itemName: "コスメデコルテ",
        },
        {
          url: "https://www.cosmedecorte.com/product/cosme_decorte/JELA",
          itemName: "コスメデコルテ ザ スキン ミニマリスト",
        },
      ],
      "コスメデコルテ ザ スキン ミニマリスト",
      { brand: "コスメデコルテ", minScore: 4 },
    );
    assert.ok(best);
    assert.ok(best.url.includes("cosmedecorte.com"));
    assert.ok(!best.url.includes("rakuten"));
    assert.ok(!best.url.includes("amazon"));
  }

  {
    const r = await resolveProductPageUrl({
      productId: "p1",
      brand: "コスメデコルテ",
      currentUrl: "https://www.cosmedecorte.com/product/x/y",
    });
    assert.strictEqual(r.source, "existing");
  }

  {
    const mapPath = tmpJson("map-mall", {
      "beauty-main-001": "https://item.rakuten.co.jp/shop/x/",
    });
    const r = await resolveProductPageUrl(
      {
        productId: "beauty-main-001",
        brand: "コスメデコルテ",
        productName: "ザ スキン",
        currentUrl: "https://example.com/x",
      },
      { mapPath, provider: "map", skipSearch: true },
    );
    assert.strictEqual(r.url, null);
    assert.ok(String(r.detail?.steps?.[1]?.reason || "").includes("VC許可外"));
    fs.unlinkSync(mapPath);
  }

  {
    const mapPath = tmpJson("map-ok", {
      "beauty-main-001": "https://www.cosmedecorte.com/product/cosme_decorte/TEST",
    });
    const r = await resolveProductPageUrl(
      {
        productId: "beauty-main-001",
        brand: "コスメデコルテ",
        currentUrl: "https://example.com/decorte-main-item",
      },
      { mapPath, provider: "map" },
    );
    assert.strictEqual(r.source, "map");
    assert.ok(r.url.includes("cosmedecorte.com"));
    fs.unlinkSync(mapPath);
  }

  {
    const mapPath = tmpJson("map-search", {});
    const mockOfficial =
      "https://www.cosmedecorte.com/product/cosme_decorte/MINIMALIST";
    const mockHtml = `
      <a href="https://item.rakuten.co.jp/shop/decorte/">rakuten</a>
      <a href="https://www.amazon.co.jp/dp/B00TEST">amazon</a>
      <a href="${mockOfficial}">official</a>
    `;
    const r = await resolveProductPageUrl(
      {
        productId: "beauty-main-001",
        brand: "コスメデコルテ",
        productName: "ザ スキン ミニマリスト ファンデーション",
        currentUrl: "https://example.com/x",
      },
      {
        mapPath,
        provider: "auto",
        searchOpts: {
          chain: "rakuten,web",
          fetchImpl: async () => ({
            status: 200,
            ok: true,
            text: async () => mockHtml,
          }),
        },
      },
    );
    assert.strictEqual(r.source, "web");
    assert.strictEqual(r.url, mockOfficial);
    const flatSteps = [];
    for (const s of r.detail?.steps || []) {
      flatSteps.push(s);
      if (Array.isArray(s.steps)) flatSteps.push(...s.steps);
    }
    assert.ok(
      flatSteps.some((s) => s.provider === "rakuten" && s.skipped),
      "rakuten should be skipped in chain",
    );
    fs.unlinkSync(mapPath);
  }

  {
    const productsPath = tmpJson("products", {
      main: [{ id: "beauty-main-001", productUrl: "https://example.com/old" }],
    });
    const mapPath = tmpJson("map-wb", { _comment: "keep" });
    const url = "https://www.cosmedecorte.com/product/cosme_decorte/NEW";
    assert.strictEqual(
      writeBackProductUrl("beauty-main-001", url, productsPath, {
        brand: "コスメデコルテ",
      }),
      true,
    );
    assert.strictEqual(
      writeBackProductUrl(
        "beauty-main-001",
        "https://item.rakuten.co.jp/x/y/",
        productsPath,
        { brand: "コスメデコルテ" },
      ),
      false,
    );
    assert.strictEqual(
      writeBackUrlMap("beauty-main-001", url, mapPath, {
        brand: "コスメデコルテ",
      }),
      true,
    );
    const afterP = JSON.parse(fs.readFileSync(productsPath, "utf8"));
    const afterM = JSON.parse(fs.readFileSync(mapPath, "utf8"));
    assert.strictEqual(afterP.main[0].productUrl, url);
    assert.strictEqual(afterM["beauty-main-001"], url);
    fs.unlinkSync(productsPath);
    fs.unlinkSync(mapPath);
  }

  assert.ok(
    normalizeMerchantUrl(
      "https://duckduckgo.com/l/?uddg=" +
        encodeURIComponent("https://www.cosmedecorte.com/product/a/b"),
    ).includes("cosmedecorte.com"),
  );

  console.log("test-resolve-product-url: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
