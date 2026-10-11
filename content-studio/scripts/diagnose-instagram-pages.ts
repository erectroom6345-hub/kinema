/**
 * /me/accounts と各 Page の IG 連携状態を一覧表示する。
 *
 *   npx tsx scripts/diagnose-instagram-pages.ts
 */
import {
  debugInstagramAccessToken,
  diagnoseInstagramPageLinks,
  fetchPageTokenByPageId,
  loadInstagramEnvFromFile,
} from "../src/services/instagramAuth.ts";

function mask(value: string, head = 8, tail = 4): string {
  const v = value.trim();
  if (!v) return "(empty)";
  if (v.length <= head + tail) return "***";
  return `${v.slice(0, head)}...${v.slice(-tail)}`;
}

async function main(): Promise<void> {
  loadInstagramEnvFromFile();
  const token = (process.env.INSTAGRAM_ACCESS_TOKEN ?? "").trim();
  const ig = (process.env.INSTAGRAM_ACCOUNT_ID ?? "").trim();
  const pageId = (
    process.env.FACEBOOK_PAGE_ID ||
    process.env.INSTAGRAM_FACEBOOK_PAGE_ID ||
    ""
  ).trim();

  console.log(`INSTAGRAM_ACCESS_TOKEN=${mask(token)}`);
  console.log(`INSTAGRAM_ACCOUNT_ID=${ig || "(missing)"}`);
  console.log(`FACEBOOK_PAGE_ID=${pageId || "(unset)"}`);

  const debug = await debugInstagramAccessToken(token);
  console.log(
    `\n[token] kind=${debug.kind} type=${debug.type ?? "?"} is_valid=${debug.isValid}` +
      (debug.scopes?.length ? ` scopes=${debug.scopes.join(",")}` : ""),
  );

  const diag = await diagnoseInstagramPageLinks({ userAccessToken: token, igAccountId: ig });
  const granted = diag.permissions
    .filter((p) => p.status === "granted")
    .map((p) => p.permission)
    .filter(Boolean);
  console.log(`\n[permissions granted] ${granted.join(", ") || "(none)"}`);
  console.log(
    `business_management=${granted.includes("business_management") ? "yes" : "NO"}`,
  );

  console.log(`\n[/me/accounts] count=${diag.pages.length}`);
  if (diag.emptyAccounts) {
    console.log("  (empty)");
  }
  for (const p of diag.pages) {
    const match =
      ig &&
      [p.instagramBusinessAccountId, p.connectedInstagramAccountId].includes(ig)
        ? " MATCH"
        : "";
    console.log(
      `  page=${p.id} name=${p.name ?? "?"}` +
        ` iba=${p.instagramBusinessAccountId ?? "-"}${p.instagramBusinessUsername ? `(${p.instagramBusinessUsername})` : ""}` +
        ` cia=${p.connectedInstagramAccountId ?? "-"}${p.connectedInstagramUsername ? `(${p.connectedInstagramUsername})` : ""}` +
        ` token=${p.accessToken ? "yes" : "no"}${match}`,
    );
  }

  if (diag.matchPageId) {
    console.log(`\n[result] INSTAGRAM_ACCOUNT_ID に一致: page=${diag.matchPageId}`);
  } else if (!diag.emptyAccounts) {
    console.log(
      `\n[result] Page はあるが INSTAGRAM_ACCOUNT_ID=${ig} に一致なし` +
        " → 照合フィールド/ID不一致の可能性",
    );
  } else {
    console.log(
      "\n[result] /me/accounts が空 → Graph 取得ロジックや ID 照合より先に権限/Business 問題",
    );
  }
  if (diag.hint) console.log(`\n[hint]${diag.hint}`);

  if (pageId) {
    console.log(`\n[FACEBOOK_PAGE_ID 直接取得] page=${pageId}`);
    try {
      const direct = await fetchPageTokenByPageId({
        userAccessToken: token,
        pageId,
        igAccountId: ig,
      });
      if (direct) {
        console.log(
          `  OK page=${direct.pageId} name=${direct.pageName ?? "?"} token=${mask(direct.accessToken)}`,
        );
      } else {
        console.log("  NG: access_token が取れませんでした");
      }
    } catch (err) {
      console.log(`  NG: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log("\n--- 見方 ---");
  console.log("成功: pages>=1 かつ MATCH あり、または FACEBOOK_PAGE_ID 直接取得 OK");
  console.log(
    "失敗(空): business_management を付けて再認可 / または FACEBOOK_PAGE_ID を設定",
  );
  console.log("失敗(不一致): INSTAGRAM_ACCOUNT_ID と iba/cia の id を突き合わせる");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
