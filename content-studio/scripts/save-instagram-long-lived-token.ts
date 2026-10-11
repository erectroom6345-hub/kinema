/**
 * Instagram（Facebook Graph / graph.facebook.com）の token を長期化し .env に保存する。
 *
 * このプロジェクトの投稿は graph.facebook.com + USER/Page token（EAA/EAG…）想定。
 * Instagram Login（graph.instagram.com / IGQ…）とは別経路。
 *
 *   # いまの .env token を診断のみ
 *   npx tsx scripts/save-instagram-long-lived-token.ts --diagnose
 *
 *   # Graph API Explorer 等で取った短命 User token を長期化して保存
 *   npx tsx scripts/save-instagram-long-lived-token.ts --short-token='EAA...'
 *
 *   # 長期 User token のまま、紐づく Page token（無期限寄り）を保存
 *   npx tsx scripts/save-instagram-long-lived-token.ts --prefer-page-token
 *
 * 必要: FACEBOOK_APP_ID / FACEBOOK_APP_SECRET（交換時）
 * 任意: INSTAGRAM_ACCOUNT_ID（--prefer-page-token 時）
 */
import {
  debugInstagramAccessToken,
  exchangeFacebookShortLivedForLongLived,
  fetchPageTokenForInstagramAccount,
  loadInstagramEnvFromFile,
  persistInstagramAccessToken,
} from "../src/services/instagramAuth.ts";

function argValue(name: string): string {
  const prefix = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (hit) return hit.slice(prefix.length).trim();
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1].trim();
  return "";
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function mask(value: string, head = 8, tail = 4): string {
  const v = value.trim();
  if (!v) return "(empty)";
  if (v.length <= head + tail) return "***";
  return `${v.slice(0, head)}...${v.slice(-tail)}`;
}

function printDebug(label: string, d: Awaited<ReturnType<typeof debugInstagramAccessToken>>): void {
  console.log(`\n=== ${label} ===`);
  console.log(`kind=${d.kind} type=${d.type ?? "?"} is_valid=${d.isValid}`);
  console.log(`app_id=${d.appId ?? "?"}`);
  if (d.expiresAt === 0) console.log("expires_at=0 (never / no expiry field)");
  else if (d.expiresAt)
    console.log(
      `expires_at=${d.expiresAt} (${new Date(d.expiresAt * 1000).toISOString()})` +
        (d.daysRemaining != null ? ` remaining≈${d.daysRemaining.toFixed(1)}d` : ""),
    );
  if (d.lifetimeDays != null) console.log(`lifetime≈${d.lifetimeDays.toFixed(1)}d`);
  if (d.scopes?.length) console.log(`scopes=${d.scopes.join(",")}`);
  console.log(
    d.kind === "long-lived" || d.kind === "never-expires"
      ? "判定: 長期運用向け（短命ではない）"
      : d.kind === "short-lived"
        ? "判定: 短命。fb_exchange_token で長期化してから .env へ"
        : `判定: ${d.kind}`,
  );
}

async function main(): Promise<void> {
  loadInstagramEnvFromFile();

  const appId = (
    process.env.FACEBOOK_APP_ID ||
    process.env.META_APP_ID ||
    process.env.INSTAGRAM_APP_ID ||
    ""
  ).trim();
  const appSecret = (
    process.env.FACEBOOK_APP_SECRET ||
    process.env.META_APP_SECRET ||
    process.env.INSTAGRAM_APP_SECRET ||
    ""
  ).trim();
  console.log(`FACEBOOK_APP_ID=${appId ? mask(appId, 4, 4) : "(missing)"}`);
  console.log(`FACEBOOK_APP_SECRET=${appSecret ? "(set)" : "(missing)"}`);
  console.log(`INSTAGRAM_ACCOUNT_ID=${(process.env.INSTAGRAM_ACCOUNT_ID || "").trim() || "(missing)"}`);

  if (hasFlag("--diagnose")) {
    const token = (process.env.INSTAGRAM_ACCESS_TOKEN || "").trim();
    console.log(`INSTAGRAM_ACCESS_TOKEN=${mask(token)} len=${token.length}`);
    const d = await debugInstagramAccessToken(token);
    printDebug("current .env token", d);
    return;
  }

  let workingToken = argValue("--short-token") || (process.env.INSTAGRAM_ACCESS_TOKEN || "").trim();
  if (!workingToken) {
    throw new Error("使い方: --diagnose / --short-token=... / --prefer-page-token");
  }

  // 短命なら交換。既に長期ならそのまま使う。
  const before = await debugInstagramAccessToken(workingToken);
  printDebug("input token", before);

  if (before.kind === "short-lived" || hasFlag("--force-exchange")) {
    if (!appId || !appSecret) {
      throw new Error("長期交換には FACEBOOK_APP_ID / FACEBOOK_APP_SECRET が必要です");
    }
    console.log("\n[exchange] grant_type=fb_exchange_token → 長期 User token");
    const longLived = await exchangeFacebookShortLivedForLongLived({
      shortLivedToken: workingToken,
      appId,
      appSecret,
    });
    workingToken = longLived.accessToken;
    console.log(
      `長期 token=${mask(workingToken)} expires_in=${longLived.expiresIn ?? "?"} kind=${longLived.kind}`,
    );
  } else if (before.kind === "invalid") {
    throw new Error("token が無効です。Graph API Explorer 等で短命tokenを取り直してください");
  } else {
    console.log("\n[exchange] スキップ（既に長期/無期限の可能性）");
  }

  if (hasFlag("--prefer-page-token")) {
    console.log(
      "\n[page] /me/accounts（iba/cia）または FACEBOOK_PAGE_ID から Page token を取得",
    );
    const page = await fetchPageTokenForInstagramAccount({
      userAccessToken: workingToken,
      verbose: true,
    });
    if (!page) {
      throw new Error(
        "紐づく Page token が見つかりません。" +
          " 診断: npx tsx scripts/diagnose-instagram-pages.ts" +
          " / Business Suite 配下なら business_management 再認可か FACEBOOK_PAGE_ID を設定",
      );
    }
    console.log(`page id=${page.pageId} name=${page.pageName ?? "?"}`);
    workingToken = page.accessToken;
  }

  persistInstagramAccessToken(workingToken);
  const after = await debugInstagramAccessToken(workingToken);
  printDebug("saved token", after);
  console.log("\n完了: INSTAGRAM_ACCESS_TOKEN を更新しました");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
