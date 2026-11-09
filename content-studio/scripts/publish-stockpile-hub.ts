/**
 * 備蓄期間専用のまとめ固定ページを food / gadget ブログに作成・更新する。
 *
 *   npx tsx scripts/publish-stockpile-hub.ts --genre=food --dry-run
 *   npx tsx scripts/publish-stockpile-hub.ts --genre=food --apply
 *   npx tsx scripts/publish-stockpile-hub.ts --genre=gadget --apply
 *
 * 成功後 .env の {GENRE}_STOCKPILE_PAGE_URL を更新する。
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ApiBloggerClient, createBloggerClient } from "../src/adapters/blogger.ts";
import { AppError } from "../src/utils/errors.ts";

const require = createRequire(import.meta.url);
const {
  buildAffiliateImageBanner,
}: {
  buildAffiliateImageBanner: (opts: {
    name?: string;
    url?: string;
    imageUrl?: string;
    priceRange?: string;
    productId?: string;
    className?: string;
  }) => string;
} = require("./lib/affiliate-image-banner.cjs");

const root = process.cwd();

type Genre = "food" | "gadget";

function arg(name: string): string {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : "";
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function upsertEnvValue(envPath: string, key: string, value: string): void {
  const raw = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  const next = re.test(raw)
    ? raw.replace(re, line)
    : `${raw.replace(/\s*$/, "")}\n${line}\n`;
  fs.writeFileSync(envPath, next.endsWith("\n") ? next : `${next}\n`, "utf8");
}

type Product = {
  id?: string;
  name?: string;
  nameRaw?: string;
  description?: string;
  rakutenUrl?: string;
  url?: string;
  imageUrl?: string;
  priceRange?: string;
  category?: string;
  labels?: { stockpile?: boolean };
};

function trackRakutenUrl(rawUrl: string, productId: string, genre: Genre): string {
  try {
    const u = new URL(rawUrl);
    if (!u.searchParams.has("utm_source")) u.searchParams.set("utm_source", "blogger");
    if (!u.searchParams.has("utm_medium")) u.searchParams.set("utm_medium", "affiliate");
    if (!u.searchParams.has("utm_campaign")) {
      u.searchParams.set("utm_campaign", `${genre}_${productId || "stockpile"}`);
    }
    return u.toString();
  } catch {
    return rawUrl;
  }
}

function flattenMain(filePath: string): Product[] {
  const doc = readJson<{ main?: Product[]; sale?: Product[] }>(filePath, {});
  return [...(doc.sale || []), ...(doc.main || [])];
}

function matchesStockpile(p: Product, genre: Genre): boolean {
  if (p.labels?.stockpile) return true;
  const blob = `${p.name || ""} ${p.nameRaw || ""} ${p.description || ""}`;
  if (genre === "gadget") {
    return /備蓄|防災|非常用|携帯トイレ|簡易トイレ|防災ラジオ|手回し|懐中電灯|ランタン|LEDライト|モバイルバッテリー|停電|防災グッズ/i.test(
      blob,
    );
  }
  return /備蓄|非常食|保存食|防災食|ローリングストック|日持ち|常温保存|缶詰|レトルト|フリーズドライ|乾麺|長期保存|保存用|水 長期|カンパン|乾パン|羊羹|ようかん|ペコちゃん|不二家/i.test(
    blob,
  );
}

function foodClassicRe(): RegExp {
  return /羊羹|ようかん|えいようかん|ペコ|不二家|カンパン|乾パン/i;
}

function pickProducts(genre: Genre, limit = 14): Product[] {
  const file =
    genre === "food"
      ? path.join(root, "input", "products-food.json")
      : path.join(root, "input", "products-gadget.json");
  const all = flattenMain(file).filter((p) => matchesStockpile(p, genre));
  const withUrl = all.filter((p) => (p.rakutenUrl || p.url || "").trim());
  const pool = (withUrl.length ? withUrl : all).slice().sort((a, b) => {
    const ai = (a.imageUrl || "").trim() ? 0 : 1;
    const bi = (b.imageUrl || "").trim() ? 0 : 1;
    return ai - bi;
  });

  // food: 定番（羊羹・ペコ・カンパン）を種別ごとに最低1件確保してから残りを埋める
  if (genre === "food") {
    const blobOf = (p: Product) => `${p.name || ""} ${p.nameRaw || ""} ${p.description || ""}`;
    const classic = pool.filter((p) => foodClassicRe().test(blobOf(p)));
    const takeBest = (re: RegExp, n: number) =>
      classic.filter((p) => re.test(blobOf(p))).slice(0, n);
    const seeded = [
      ...takeBest(/チョコ.*羊羹|チョコようかん|チョコえいようかん|えいようかん/i, 2),
      ...takeBest(/ペコ|不二家/i, 2),
      ...takeBest(/カンパン|乾パン/i, 2),
    ];
    const seededIds = new Set(seeded.map((p) => p.id || p.name));
    const classicExtra = classic.filter((p) => !seededIds.has(p.id || p.name));
    const classicPicked = [...seeded, ...classicExtra].slice(0, 6);
    const classicIds = new Set(classicPicked.map((p) => p.id || p.name));
    const rest = pool.filter((p) => !classicIds.has(p.id || p.name));
    return [...classicPicked, ...rest].slice(0, limit);
  }
  return pool.slice(0, limit);
}

function productListHtml(products: Product[], genre: Genre): string {
  if (!products.length) {
    return "<p>候補はこれから足していきます。日持ちする常備を、少しずつ揃えてみてください。</p>";
  }
  return products
    .map((p) => {
      const id = String(p.id || "").trim();
      const rawUrl = (p.rakutenUrl || p.url || "").trim();
      return buildAffiliateImageBanner({
        name: (p.name || p.nameRaw || "商品").slice(0, 60),
        url: rawUrl ? trackRakutenUrl(rawUrl, id, genre) : "",
        imageUrl: (p.imageUrl || "").trim(),
        priceRange: String(p.priceRange || "").trim(),
        productId: id,
        className: "stockpile-banner",
      });
    })
    .join("\n");
}

function buildFoodHtml(products: Product[]): string {
  const classicRe = foodClassicRe();
  const waterRe = /水|飲料|ペットボトル/i;
  const classic = products.filter((p) =>
    classicRe.test(`${p.name || ""}${p.nameRaw || ""}${p.description || ""}`),
  );
  const water = products.filter((p) =>
    waterRe.test(`${p.name || ""}${p.nameRaw || ""}`),
  );
  const staple = products.filter((p) => {
    const blob = `${p.name || ""}${p.nameRaw || ""}${p.description || ""}`;
    return !classicRe.test(blob) && !waterRe.test(`${p.name || ""}${p.nameRaw || ""}`);
  });
  return [
    "<p>家庭の常備備蓄として、日持ちする食べ物や水をまとめています。ふだん食べるものを少し多めに置く、ローリングストックの考え方です。チョコ羊羹やペコちゃんの缶、カンパンなど定番のごほうび枠も混ぜています。</p>",
    "<h3>定番のごほうび（羊羹・ペコちゃん缶・カンパン）</h3>",
    productListHtml(classic.length ? classic : [], "food"),
    "<h3>食料（美味しい日持ち・レトルト・缶詰）</h3>",
    productListHtml(staple, "food"),
    "<h3>水・常温飲料</h3>",
    "<p>飲料水は人数×日数で足りるかだけ先に見ておくと安心です。長期保存水や常温で置ける飲料を少し多めに。</p>",
    productListHtml(water, "food"),
    "<h3>備えグッズ（トイレ・電灯・ラジオ）</h3>",
    "<p>携帯トイレや電灯、ラジオはガジェット側の備えページにまとめています。</p>",
    "<p>※PR 商品リンクにはアフィリエイトを含む場合があります。期間限定のまとめです。</p>",
  ].join("\n");
}

function buildGadgetHtml(products: Product[]): string {
  const toilet = products.filter((p) => /トイレ/i.test(`${p.name}${p.nameRaw}${p.description}`));
  const light = products.filter((p) =>
    /電灯|ランタン|ライト|LED/i.test(`${p.name}${p.nameRaw}${p.description}`),
  );
  const radio = products.filter((p) => /ラジオ|手回し/i.test(`${p.name}${p.nameRaw}${p.description}`));
  const power = products.filter((p) =>
    /バッテリー|充電|電源/i.test(`${p.name}${p.nameRaw}${p.description}`),
  );
  return [
    "<p>家庭の備えとして、携帯トイレ・電灯・ラジオ・電源まわりをまとめています。デスク小物の普段使いとは別に、置きやすいサイズを中心にしています。</p>",
    "<h3>携帯トイレ・衛生</h3>",
    productListHtml(toilet.length ? toilet : products.slice(0, 2), "gadget"),
    "<h3>電灯・ランタン</h3>",
    productListHtml(light.length ? light : [], "gadget"),
    "<h3>ラジオ・情報</h3>",
    productListHtml(radio.length ? radio : [], "gadget"),
    "<h3>電源・モバイルバッテリー</h3>",
    productListHtml(power.length ? power : [], "gadget"),
    "<h3>食料・水</h3>",
    "<p>日持ちする食べ物や水は、食べ物側の備蓄ページにまとめています。</p>",
    "<p>※PR 商品リンクにはアフィリエイトを含む場合があります。期間限定のまとめです。</p>",
  ].join("\n");
}

async function insertOrUpdatePage(params: {
  client: ApiBloggerClient;
  blogId: string;
  title: string;
  contentHtml: string;
  existingPageId?: string | null;
}): Promise<{ pageId: string; url: string }> {
  const accessToken = await params.client.refreshAccessToken();
  const existingId = (params.existingPageId || "").trim();

  if (existingId) {
    const endpoint =
      `https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(params.blogId)}/pages/` +
      `${encodeURIComponent(existingId)}`;
    const res = await fetch(endpoint, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: params.title,
        content: params.contentHtml,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      url?: string;
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new AppError(
        `Blogger pages.patch 失敗: ${data.error?.message || `HTTP ${res.status}`}`,
        "BLOGGER_PAGE_PATCH_FAILED",
      );
    }
    return { pageId: (data.id || existingId).trim(), url: (data.url || "").trim() };
  }

  const listRes = await fetch(
    `https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(params.blogId)}/pages?status=LIVE`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const listData = (await listRes.json().catch(() => ({}))) as {
    items?: Array<{ id?: string; title?: string; url?: string }>;
    error?: { message?: string };
  };
  if (!listRes.ok) {
    throw new AppError(
      `Blogger pages.list 失敗: ${listData.error?.message || `HTTP ${listRes.status}`}`,
      "BLOGGER_PAGE_LIST_FAILED",
    );
  }
  const found = (listData.items || []).find((p) => (p.title || "").trim() === params.title);
  if (found?.id) {
    return insertOrUpdatePage({ ...params, existingPageId: found.id });
  }

  const endpoint =
    `https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(params.blogId)}/pages` +
    `?isDraft=false`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      kind: "blogger#page",
      title: params.title,
      content: params.contentHtml,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
    url?: string;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new AppError(
      `Blogger pages.insert 失敗: ${data.error?.message || `HTTP ${res.status}`}`,
      "BLOGGER_PAGE_INSERT_FAILED",
    );
  }
  return { pageId: String(data.id || "").trim(), url: String(data.url || "").trim() };
}

async function main() {
  const genre = (arg("--genre") || "food").trim().toLowerCase() as Genre;
  if (genre !== "food" && genre !== "gadget") {
    throw new Error("--genre=food|gadget が必要です");
  }
  const apply = hasFlag("--apply");
  const blogIdEnv = genre === "food" ? "FOOD_BLOGGER_BLOG_ID" : "GADGET_BLOGGER_BLOG_ID";
  const pageUrlEnv =
    genre === "food" ? "FOOD_STOCKPILE_PAGE_URL" : "GADGET_STOCKPILE_PAGE_URL";
  const pageIdEnv =
    genre === "food" ? "FOOD_STOCKPILE_PAGE_ID" : "GADGET_STOCKPILE_PAGE_ID";
  const blogId = String(process.env[blogIdEnv] || "").trim();
  if (!blogId) throw new Error(`${blogIdEnv} が空です`);

  const title =
    genre === "food"
      ? "家庭の常備備蓄まとめ（期間限定）"
      : "家庭の備えグッズまとめ（期間限定）";
  const products = pickProducts(genre, genre === "food" ? 14 : 10);
  const html = genre === "food" ? buildFoodHtml(products) : buildGadgetHtml(products);

  const outDir = path.join(root, "output", "stockpile-hubs");
  fs.mkdirSync(outDir, { recursive: true });
  const localHtmlPath = path.join(outDir, `${genre}-stockpile-hub.html`);
  fs.writeFileSync(localHtmlPath, html.endsWith("\n") ? html : `${html}\n`, "utf8");

  console.log(`genre=${genre} products=${products.length} apply=${apply}`);
  console.log(`title=${title}`);
  console.log(`localHtml=${localHtmlPath}`);
  if (!apply) {
    console.log("--- dry-run html preview ---");
    console.log(html.slice(0, 1200));
    console.log("...");
    console.log(
      "Blogger 公開は --apply。BLOGGER_REFRESH_TOKEN が有効なときだけ成功します。",
    );
    return;
  }

  const client = createBloggerClient() as ApiBloggerClient;
  const existingPageId = String(process.env[pageIdEnv] || "").trim();
  const result = await insertOrUpdatePage({
    client,
    blogId,
    title,
    contentHtml: html,
    existingPageId,
  });
  if (!result.url) {
    throw new AppError("備蓄ページURLが空です", "STOCKPILE_PAGE_URL_EMPTY");
  }

  const envPath = path.join(root, ".env");
  upsertEnvValue(envPath, pageUrlEnv, result.url);
  if (result.pageId) upsertEnvValue(envPath, pageIdEnv, result.pageId);

  const registryPath = path.join(root, "data", `${genre}-blog-roundups.json`);
  const registry = readJson<Record<string, unknown>>(registryPath, {});
  registry.stockpilePageUrl = result.url;
  registry.stockpilePageId = result.pageId;
  registry.stockpileUpdatedAt = new Date().toISOString();
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");

  console.log(`saved ${pageUrlEnv}=${result.url}`);
  console.log(`pageId=${result.pageId}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
