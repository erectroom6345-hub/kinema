/**
 * gadget まとめ記事（roundups）を Blogger に公開 / 更新する。
 *
 *   npx tsx scripts/publish-gadget-roundups.ts --dry-run
 *   npx tsx scripts/publish-gadget-roundups.ts --apply
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createBloggerClient } from "../src/adapters/blogger.ts";
import { getConfig, loadEnv } from "../src/config/env.ts";

const root = process.cwd();
const registryPath = path.join(root, "data", "gadget-blog-roundups.json");

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

type RoundupCurrent = {
  postId?: string | null;
  url?: string | null;
  title: string;
  productIds: string[];
  localPath?: string | null;
  index?: number;
};

type Registry = {
  categories: Record<
    string,
    {
      current: RoundupCurrent;
      archive: RoundupCurrent[];
    }
  >;
  updatedAt?: string;
};

async function main(): Promise<void> {
  const apply = hasFlag("--apply");
  const dryRun = hasFlag("--dry-run") || !apply;

  const registry = readJson<Registry>(registryPath, { categories: {} });
  const cats = Object.keys(registry.categories || {});
  if (!cats.length) {
    throw new Error(
      "data/gadget-blog-roundups.json が空です。先に node scripts/seed-gadget-blog.cjs --apply",
    );
  }

  loadEnv();
  const config = getConfig();
  // ガジェット専用ブログ優先（未設定なら共通 BLOGGER_BLOG_ID）
  const blogId = (
    process.env.GADGET_BLOGGER_BLOG_ID ||
    config.bloggerBlogId ||
    ""
  ).trim();

  if (dryRun) {
    for (const cat of cats) {
      const cur = registry.categories[cat].current;
      const htmlPath = cur.localPath ? path.join(root, cur.localPath) : "";
      const exists = htmlPath && fs.existsSync(htmlPath);
      console.log(
        `[dry-run] ${cat}: title=${cur.title} products=${(cur.productIds || []).length}` +
          ` html=${exists ? "yes" : "no"} postId=${cur.postId || "(new)"}`,
      );
    }
    console.log(
      `[dry-run] blogId=${blogId || "(unset)"} source=${
        (process.env.GADGET_BLOGGER_BLOG_ID || "").trim()
          ? "GADGET_BLOGGER_BLOG_ID"
          : "BLOGGER_BLOG_ID"
      }`,
    );
    console.log("apply するには: npx tsx scripts/publish-gadget-roundups.ts --apply");
    return;
  }

  if (!blogId) {
    throw new Error(
      "GADGET_BLOGGER_BLOG_ID（推奨）または BLOGGER_BLOG_ID が未設定です",
    );
  }
  const client = createBloggerClient();

  for (const cat of cats) {
    const cur = registry.categories[cat].current;
    if (!cur?.localPath) {
      console.warn(`${cat}: localPath なし → スキップ`);
      continue;
    }
    const htmlPath = path.join(root, cur.localPath);
    if (!fs.existsSync(htmlPath)) {
      console.warn(`${cat}: HTMLなし ${htmlPath}`);
      continue;
    }
    const contentHtml = fs.readFileSync(htmlPath, "utf8");
    const labels = ["gadget", cat, "roundup"];

    if (cur.postId && client.patchPostContent) {
      console.log(`${cat}: 既存記事を更新 postId=${cur.postId}`);
      const patched = await client.patchPostContent(blogId, cur.postId, contentHtml);
      cur.url = patched.url || cur.url;
      cur.postId = patched.id || cur.postId;
    } else {
      console.log(`${cat}: 新規公開 title=${cur.title}`);
      const created = await client.saveDraft({
        blogId,
        title: cur.title,
        contentHtml,
        labels,
        isDraft: false,
      });
      cur.postId = created.postId;
      cur.url = created.url || null;
    }
    console.log(`  → ${cur.url || cur.postId}`);
    // 途中で quota 等に落ちても、成功分の postId を残す
    registry.updatedAt = new Date().toISOString();
    writeJson(registryPath, registry);
  }

  console.log(`registry 更新: ${registryPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
