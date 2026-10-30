#!/usr/bin/env node
/**
 * 需要ウォッチの手動OK / 解除 / 一覧。
 *
 *   node scripts/demand-watch-approve.cjs --status
 *   node scripts/demand-watch-approve.cjs --list-candidates
 *   node scripts/demand-watch-approve.cjs --approve --theme=stinkbug
 *   node scripts/demand-watch-approve.cjs --approve --theme=stinkbug --days=21
 *   node scripts/demand-watch-approve.cjs --clear --theme=stinkbug
 */
const {
  loadDemandPolicy,
  loadCandidates,
  loadActive,
  listActiveWindows,
  approveTheme,
  clearTheme,
  pruneExpiredWindows,
  themeById,
} = require("./lib/demand-watch.cjs");

function parseArgs(argv) {
  const out = {
    status: false,
    listCandidates: false,
    approve: false,
    clear: false,
    themeId: "",
    days: 0,
    note: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--status") out.status = true;
    else if (a === "--list-candidates" || a === "--list") out.listCandidates = true;
    else if (a === "--approve") out.approve = true;
    else if (a === "--clear") out.clear = true;
    else if (a === "--theme" && argv[i + 1]) {
      out.themeId = String(argv[++i] || "").trim();
    } else if (a.startsWith("--theme=")) {
      out.themeId = a.slice("--theme=".length).trim();
    } else if (a === "--days" && argv[i + 1]) {
      out.days = Number(argv[++i]) || 0;
    } else if (a.startsWith("--days=")) {
      out.days = Number(a.slice("--days=".length)) || 0;
    } else if (a === "--note" && argv[i + 1]) {
      out.note = String(argv[++i] || "");
    } else if (a.startsWith("--note=")) {
      out.note = a.slice("--note=".length);
    }
  }
  return out;
}

function printActive() {
  pruneExpiredWindows();
  const windows = listActiveWindows();
  if (!windows.length) {
    console.log("[demand] active: (なし)");
    return;
  }
  console.log(`[demand] active: ${windows.length}件`);
  for (const w of windows) {
    console.log(
      `  - ${w.themeId} ${w.title || ""} ${w.start}→${w.end}` +
        ` genres=${(w.genres || []).join(",") || "-"}`,
    );
    for (const h of w.ingestHints || []) {
      console.log(
        `      ingest: [${h.genre}/${h.category}] ${h.keyword}`,
      );
    }
  }
}

function printCandidates() {
  const c = loadCandidates();
  const pending = c.pending || [];
  if (!pending.length) {
    console.log("[demand] candidates: (なし)");
    return;
  }
  console.log(`[demand] candidates: ${pending.length}件`);
  for (const p of pending) {
    console.log(
      `  - ${p.themeId} ${p.title || ""} day=${p.day || "-"}` +
        ` reviews=${p.reviewSum ?? "-"} count=${p.apiCount ?? "-"}` +
        ` reason=${p.reason || "-"}`,
    );
    console.log(`      OK: npm run demand:approve -- --theme=${p.themeId}`);
  }
}

function printDictionary() {
  const policy = loadDemandPolicy();
  console.log(`[demand] dictionary themes=${policy.themes.length}`);
  for (const t of policy.themes) {
    console.log(
      `  - ${t.id}: ${t.title} [${(t.genres || []).join(",")}] ` +
        `pulse="${t.pulseKeyword}"`,
    );
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const anyAction = args.status || args.listCandidates || args.approve || args.clear;

  if (!anyAction) {
    printDictionary();
    printCandidates();
    printActive();
    console.log(
      "\n使い方: --status | --list-candidates | --approve --theme=ID | --clear --theme=ID",
    );
    return;
  }

  if (args.status) {
    printDictionary();
    printCandidates();
    printActive();
  }
  if (args.listCandidates) printCandidates();

  if (args.approve) {
    if (!args.themeId) throw new Error("--approve には --theme=ID が必要です");
    const policy = loadDemandPolicy();
    if (!themeById(policy, args.themeId)) {
      throw new Error(`未知の themeId: ${args.themeId}`);
    }
    const result = approveTheme(args.themeId, {
      days: args.days || undefined,
      note: args.note,
    });
    console.log(
      `[demand] APPROVED ${result.theme.id} ${result.window.start}→${result.window.end}`,
    );
    console.log(
      "次: 必要なら該当ジャンルの楽天カタログ再取得で ingestHints キーワードを足す。選定は次回投稿から優先。",
    );
    for (const h of result.window.ingestHints || []) {
      console.log(`  hint: ${h.genre}/${h.category} 「${h.keyword}」`);
    }
  }

  if (args.clear) {
    if (!args.themeId) throw new Error("--clear には --theme=ID が必要です");
    const result = clearTheme(args.themeId);
    console.log(`[demand] CLEARED ${args.themeId} removed=${result.removed}`);
  }
}

try {
  main();
} catch (err) {
  console.error(`[demand] FAIL ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
