/**
 * food / drink / gadget などの「入口固定ページ」を Blogger Pages API で作成・更新する。
 *
 *   npx tsx scripts/publish-genre-fixed-page.ts --genre=food --dry-run
 *   npx tsx scripts/publish-genre-fixed-page.ts --genre=food --apply
 *   npx tsx scripts/publish-genre-fixed-page.ts --genre=drink --apply
 *
 * 成功後、.env の {GENRE}_FIXED_PAGE_URL と data/{genre}-blog-roundups.json を更新する。
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { ApiBloggerClient, createBloggerClient } from "../src/adapters/blogger.ts";
import { getConfig, loadEnv } from "../src/config/env.ts";
import { AppError } from "../src/utils/errors.ts";

const root = process.cwd();

type Genre = "food" | "drink" | "gadget" | "living";

type RoundupCurrent = {
  postId?: string | null;
  url?: string | null;
  title: string;
  productIds?: string[];
};

type Registry = {
  categories: Record<string, { current: RoundupCurrent; archive?: RoundupCurrent[] }>;
  fixedPageUrl?: string | null;
  fixedPageId?: string | null;
  updatedAt?: string;
};

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

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function genreConfig(genre: Genre): {
  blogIdEnv: string;
  fixedUrlEnv: string;
  registryPath: string;
  title: string;
  intro: string;
  blogIdFallback?: string;
} {
  switch (genre) {
    case "food":
      return {
        blogIdEnv: "FOOD_BLOGGER_BLOG_ID",
        fixedUrlEnv: "FOOD_FIXED_PAGE_URL",
        registryPath: "data/food-blog-roundups.json",
        title: "旬・手土産の食べ物まとめ入口",
        intro:
          "いま買える旬の食べ物や手土産を、場面ごとにまとめています。季節もの、ギフト、銘菓、食卓の常備まで、探しやすい入口です。",
      };
    case "drink":
      return {
        blogIdEnv: "DRINK_BLOGGER_BLOG_ID",
        fixedUrlEnv: "DRINK_FIXED_PAGE_URL",
        registryPath: "data/drink-blog-roundups.json",
        title: "銘酒・季節酒まとめ入口",
        intro:
          "いま買える銘酒や季節酒を、酒質・場面ごとにまとめています。日本酒、焼酎、梅酒・リキュール、季節酒まで、探しやすい入口です。",
      };
    case "gadget":
      return {
        blogIdEnv: "GADGET_BLOGGER_BLOG_ID",
        fixedUrlEnv: "GADGET_FIXED_PAGE_URL",
        registryPath: "data/gadget-blog-roundups.json",
        title: "暮らしに役立つガジェットと小物",
        intro:
          "毎日使うガジェットや小物を、使う場面ごとに見やすくまとめています。",
      };
    case "living":
      return {
        blogIdEnv: "LIVING_BLOGGER_BLOG_ID",
        fixedUrlEnv: "LIVING_FIXED_PAGE_URL",
        registryPath: "data/living-blog-roundups.json",
        title: "暮らし便利グッズまとめ入口",
        intro: "キッチン・収納・掃除まわりの便利グッズを、場面ごとにまとめています。",
      };
  }
}

function buildHtml(intro: string, links: { title: string; url: string }[]): string {
  const items = links
    .map(
      (l) =>
        `<li style="margin:0.6em 0;"><a href="${escapeHtml(l.url)}">${escapeHtml(l.title)}</a></li>`,
    )
    .join("\n");
  return [
    `<p>${escapeHtml(intro)}</p>`,
    "<h3>カテゴリ一覧</h3>",
    `<ul>\n${items}\n</ul>`,
    "<p>気になるカテゴリから、いま買える候補を見返せます。</p>",
  ].join("\n");
}

function upsertEnvValue(envPath: string, key: string, value: string): void {
  const raw = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  let next: string;
  if (re.test(raw)) {
    next = raw.replace(re, line);
  } else {
    next = `${raw.replace(/\s*$/, "")}\n${line}\n`;
  }
  fs.writeFileSync(envPath, next.endsWith("\n") ? next : `${next}\n`, "utf8");
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
    return {
      pageId: (data.id || existingId).trim(),
      url: (data.url || "").trim(),
    };
  }

  // 既存ページ一覧から同タイトルを探す
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
  const found = (listData.items || []).find(
    (p) => (p.title || "").trim() === params.title,
  );
  if (found?.id) {
    return insertOrUpdatePage({
      ...params,
      existingPageId: found.id,
    });
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
  const pageId = (data.id || "").trim();
  const url = (data.url || "").trim();
  if (!pageId || !url) {
    throw new AppError("Blogger pages.insert 応答に id/url がありません", "BLOGGER_PAGE_NO_URL");
  }
  return { pageId, url };
}

async function main(): Promise<void> {
  const genre = (arg("--genre") || "").trim().toLowerCase() as Genre;
  if (!["food", "drink", "gadget", "living"].includes(genre)) {
    throw new Error("--genre=food|drink|gadget|living を指定してください");
  }
  const apply = hasFlag("--apply");
  const dryRun = hasFlag("--dry-run") || !apply;
  const cfg = genreConfig(genre);
  const registryPath = path.join(root, cfg.registryPath);
  const registry = readJson<Registry>(registryPath, { categories: {} });

  const links = Object.entries(registry.categories || {})
    .map(([, v]) => ({
      title: v.current?.title || "",
      url: (v.current?.url || "").trim(),
    }))
    .filter((l) => l.title && l.url);

  if (!links.length) {
    throw new Error(
      `${cfg.registryPath} に公開済みまとめがありません。先に seed + roundups:publish を実行してください。`,
    );
  }

  const contentHtml = buildHtml(cfg.intro, links);
  loadEnv();
  const config = getConfig();
  const blogId = (
    process.env[cfg.blogIdEnv] ||
    config.bloggerBlogId ||
    ""
  ).trim();

  console.log(`genre=${genre}`);
  console.log(`title=${cfg.title}`);
  console.log(`links=${links.length}`);
  console.log(`blogId=${blogId || "(unset)"}`);
  for (const l of links) console.log(`  - ${l.title}: ${l.url}`);

  if (dryRun) {
    console.log("[dry-run] HTML preview ---");
    console.log(contentHtml);
    console.log(`apply: npx tsx scripts/publish-genre-fixed-page.ts --genre=${genre} --apply`);
    return;
  }

  if (!blogId) {
    throw new Error(`${cfg.blogIdEnv} または BLOGGER_BLOG_ID が未設定です`);
  }

  const client = createBloggerClient() as ApiBloggerClient;
  if (typeof client.refreshAccessToken !== "function") {
    throw new Error("Blogger client が未設定です（OAuth を確認）");
  }

  const { pageId, url } = await insertOrUpdatePage({
    client,
    blogId,
    title: cfg.title,
    contentHtml,
    existingPageId: registry.fixedPageId || null,
  });

  console.log(`固定ページ公開: ${url}`);
  console.log(`pageId=${pageId}`);

  registry.fixedPageUrl = url;
  registry.fixedPageId = pageId;
  registry.updatedAt = new Date().toISOString();
  writeJson(registryPath, registry);

  const envPath = path.join(root, ".env");
  upsertEnvValue(envPath, cfg.fixedUrlEnv, url);
  console.log(`.env 更新: ${cfg.fixedUrlEnv}=${url}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
