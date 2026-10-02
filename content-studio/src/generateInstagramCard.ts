import "dotenv/config";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { buildInstagramCardSvg } from "./services/instagramCardTemplate.ts";

const articlePath = "input/article.json";
const instaPath = "input/instagram-post.json";

type ArticleInput = {
  title?: string;
  body?: string;
  product?: {
    id?: string;
    genre?: string;
    name?: string;
  };
};

type InstaPost = {
  imageUrl?: string;
  caption?: string;
  blogUrl?: string;
  imageSource?: string;
  [key: string]: unknown;
};

function envPath(name: string, fallback: string): string {
  const raw = (process.env[name] ?? "").trim();
  return raw || fallback;
}

function buildPitch(caption: string, body: string): string {
  const fromCaption = caption
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => line && !/^https?:\/\//i.test(line) && !line.includes("ブログ"));
  const source = (fromCaption || body || "").replace(/\s+/g, " ").trim();
  if (!source) return "気になったら、ブログで詳しく紹介しています。";
  return source.length > 42 ? `${source.slice(0, 41)}…` : source;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function git(repoDir: string, args: string[]): string {
  return execFileSync("git", ["-C", repoDir, ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/**
 * 生成PNGを instagram-cards リポジトリへ反映（add/commit/push）。
 * 同名・同内容なら commit をスキップ。認証は macOS の既存 git 資格情報を使用。
 */
function publishCardToGitHub(repoDir: string, fileName: string): void {
  const enabled = (process.env.IG_CARD_GIT_PUSH ?? "true").trim().toLowerCase();
  if (enabled === "0" || enabled === "false" || enabled === "off") {
    console.log("git反映: スキップ（IG_CARD_GIT_PUSH=false）");
    return;
  }

  console.log("git反映: 開始", { repoDir, fileName });

  try {
    git(repoDir, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    throw new Error(
      `git反映で停止（リポジトリ判定）: ${repoDir} は git リポジトリではありません。` +
        ` Public の instagram-cards を clone した場所を IG_CARD_PUBLIC_DIR に指定してください。`,
    );
  }

  const filePath = path.join(repoDir, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`git反映で停止（ファイル不在）: ${filePath}`);
  }

  try {
    git(repoDir, ["add", "--", fileName]);
    console.log("git反映: add OK");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`git反映で停止（add）: ${detail}`);
  }

  // ステージに差分がなければ（同名・同内容の再出力など）commit/push しない
  try {
    execFileSync("git", ["-C", repoDir, "diff", "--cached", "--quiet", "--", fileName], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log("git反映: 変更なし（同名ファイルが既に同一内容）→ commit/push スキップ");
    return;
  } catch {
    // exit 1 = 差分あり → commit へ
  }

  try {
    git(repoDir, [
      "commit",
      "-m",
      `Add Instagram card ${fileName}`,
    ]);
    console.log("git反映: commit OK");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`git反映で停止（commit）: ${detail}`);
  }

  try {
    // リモート先行時に備えてから push（非対話）
    console.log("git反映: pull --rebase 開始");
    git(repoDir, ["pull", "--rebase", "--autostash", "origin", "main"]);
    console.log("git反映: pull --rebase OK");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `git反映で停止（pull --rebase）: ${detail}` +
        ` / ローカルと origin/main の履歴を確認してください`,
    );
  }

  try {
    git(repoDir, ["push", "origin", "HEAD:main"]);
    console.log("git反映: push OK → origin/main");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `git反映で停止（push）: ${detail}` +
        ` / 認証を確認: 以前通した HTTPS 資格情報（Keychain）または gh auth login`,
    );
  }
}

async function main() {
  const width = Number(process.env.IG_CARD_WIDTH ?? "1080") || 1080;
  const height = Number(process.env.IG_CARD_HEIGHT ?? "1080") || 1080;
  const publicDir = path.resolve(
    envPath("IG_CARD_PUBLIC_DIR", path.join("..", "instagram-cards")),
  );
  const publicBase = (process.env.IG_CARD_PUBLIC_BASE_URL ?? "").trim().replace(/\/$/, "");

  const article = JSON.parse(fs.readFileSync(articlePath, "utf-8")) as ArticleInput;
  const insta = JSON.parse(fs.readFileSync(instaPath, "utf-8")) as InstaPost;

  const title = (article.title || article.product?.name || "Beauty Notes").trim();
  const genre = (article.product?.genre || "").trim();
  const pitch = buildPitch(insta.caption || "", article.body || "");
  const productId = (article.product?.id || "beauty").replace(/[^\w-]+/g, "_");
  const fileName = `${productId}-${stamp()}.png`;

  const svg = buildInstagramCardSvg({ title, pitch, genre, width, height });
  const png = await sharp(Buffer.from(svg)).png().toBuffer();

  fs.mkdirSync(publicDir, { recursive: true });
  const outPath = path.join(publicDir, fileName);
  fs.writeFileSync(outPath, png);

  // 作業用にも残す
  const localDir = path.resolve("output", "instagram-cards");
  fs.mkdirSync(localDir, { recursive: true });
  fs.writeFileSync(path.join(localDir, fileName), png);

  if (!publicBase) {
    throw new Error(
      "IG_CARD_PUBLIC_BASE_URL が未設定です。" +
        " 生成PNGを公開できるHTTPSベースURLを .env に設定してください。" +
        `（ファイルは生成済み: ${outPath}）`,
    );
  }

  const imageUrl = `${publicBase}/${fileName}`;
  insta.imageUrl = imageUrl;
  insta.imageSource = "template-card";
  fs.writeFileSync(instaPath, `${JSON.stringify(insta, null, 2)}\n`, "utf-8");

  console.log("Instagramカード生成成功");
  console.log(`genre: ${genre || "(未設定)"}`);
  console.log(`file: ${outPath}`);
  console.log(`imageUrl: ${imageUrl}`);
  console.log("imageSource: template-card");

  // 生成成功後に Pages 用リポジトリへ自動反映
  publishCardToGitHub(publicDir, fileName);
  console.log("git反映完了。Pages反映まで1〜2分かかることがあります:", imageUrl);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("カード生成エラー:", msg);
  process.exit(1);
});
