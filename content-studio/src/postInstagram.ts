import "dotenv/config";
import fs from "node:fs";
import { normalizeCaption } from "./utils/normalizeCaption.ts";

const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
const igUserId = process.env.INSTAGRAM_ACCOUNT_ID;
const inputPath = "input/instagram-post.json";

if (!accessToken || !igUserId) {
  throw new Error("INSTAGRAM_ACCESS_TOKEN または INSTAGRAM_ACCOUNT_ID が未設定です");
}

const raw = fs.readFileSync(inputPath, "utf-8");
const post = JSON.parse(raw) as {
  imageUrl: string;
  caption: string;
};

if (!post.imageUrl) {
  throw new Error("imageUrl が未設定です");
}

async function createMediaContainer() {
  const url = `https://graph.facebook.com/v23.0/${igUserId}/media`;
  // 投稿APIへ渡す直前の最終ゲート
  const caption = normalizeCaption(post.caption || "");
  const params = new URLSearchParams({
    image_url: post.imageUrl,
    caption,
    access_token: accessToken,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await res.json();
  console.log("media response:", data);

  if (!res.ok || !data.id) {
    throw new Error(`media作成失敗: ${JSON.stringify(data)}`);
  }

  return data.id as string;
}

async function publishMedia(creationId: string) {
  const url = `https://graph.facebook.com/v23.0/${igUserId}/media_publish`;
  const params = new URLSearchParams({
    creation_id: creationId,
    access_token: accessToken,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await res.json();
  console.log("publish response:", data);

  if (!res.ok) {
    throw new Error(`publish失敗: ${JSON.stringify(data)}`);
  }

  return data;
}

async function main() {
  const creationId = await createMediaContainer();
  console.log("creationId:", creationId);

  await new Promise((r) => setTimeout(r, 5000));

  const result = await publishMedia(creationId);
  console.log("投稿成功:", result);
}

main().catch((err) => {
  console.error("投稿エラー:", err);
  process.exit(1);
});
