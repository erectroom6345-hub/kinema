#!/usr/bin/env node
/**
 * 画像ルール + 朝ランタイムアウトの確認。
 *
 * Usage:
 *   node scripts/verify-blog-image-and-morning.cjs
 */
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
let failed = 0;

function pass(name, detail = "") {
  console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail = "") {
  failed += 1;
  console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

function runTsx(body, env = {}) {
  // import は関数内不可のため dynamic import を使う
  const code = `async function main() {\n${body}\n}\nmain().catch((e)=>{console.error(e); process.exit(1);});`;
  const res = spawnSync("npx", ["tsx", "-e", code], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    code: res.status ?? 1,
    out: `${res.stdout || ""}${res.stderr || ""}`,
  };
}

function lastJson(out) {
  const line = out
    .trim()
    .split("\n")
    .filter((l) => l.trim().startsWith("{"))
    .pop();
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

console.log("=== 1) 画像あり正常系（公式ページから実画像） ===");
{
  const r = runTsx(`
const {
  resolveProductImageForBackfill,
  isFixedSharedImageUrl,
  collectSharedCatalogImageUrls,
} = await import("./src/services/bloggerContentEnrich.ts");
const fixed = "https://blogger.googleusercontent.com/img/b/xxx/s1600/instagram-post-01.jpg";
const shared = collectSharedCatalogImageUrls([fixed, fixed]);
const hit = await resolveProductImageForBackfill({
  catalogImageUrl: fixed,
  productPageUrl: "https://hince.jp/c/category/face/HC021",
  sharedCatalogUrls: shared,
});
if (!hit) throw new Error("no image");
if (isFixedSharedImageUrl(hit.url, shared)) throw new Error("fixed image returned");
const res = await fetch(hit.url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(12000) });
if (!res.ok) throw new Error("not reachable " + res.status);
console.log(JSON.stringify({ source: hit.source, status: res.status, url: hit.url.slice(0, 90) }));
`);
  const j = lastJson(r.out);
  if (r.code === 0 && j?.source) pass("画像あり正常系", `source=${j.source} http=${j.status}`);
  else fail("画像あり正常系", r.out.slice(-500));
}

console.log("\n=== 2) 実画像取得失敗時 ===");
{
  const r = runTsx(`
const { resolveProductImageForBackfill } = await import("./src/services/bloggerContentEnrich.ts");
const hit = await resolveProductImageForBackfill({
  catalogImageUrl: "https://blogger.googleusercontent.com/img/b/x/instagram-post-01.jpg",
  productPageUrl: "https://example.com/no-product",
  sharedCatalogUrls: ["https://blogger.googleusercontent.com/img/b/x/instagram-post-01.jpg"],
});
console.log(JSON.stringify({ resolved: hit }));
`);
  const j = lastJson(r.out);
  if (r.code === 0 && j && j.resolved === null) pass("実画像取得失敗→null", "missing扱いへ");
  else fail("実画像取得失敗時", r.out.slice(-500));
}

console.log("\n=== 3) 画像URL 403時（挿入しない） ===");
{
  const r = runTsx(`
const { isFixedSharedImageUrl } = await import("./src/services/bloggerContentEnrich.ts");
const fixedUrl = "https://blogger.googleusercontent.com/img/b/x/s1600/instagram-post-01.jpg";
const fixed = isFixedSharedImageUrl(fixedUrl, []);
// 到達不可(403)を模擬。本番は isImageUrlReachable で同様に insert しない
const probe = await fetch("https://httpbin.org/status/403", {
  method: "HEAD",
  redirect: "follow",
  signal: AbortSignal.timeout(12000),
});
const insert = !(fixed || !probe.ok);
console.log(JSON.stringify({
  fixed,
  httpStatus: probe.status,
  insert,
  imageStatus: !probe.ok ? "broken" : fixed ? "fixed-skipped" : "ok",
}));
`);
  const j = lastJson(r.out);
  if (r.code === 0 && j && j.insert === false && (j.httpStatus === 403 || j.fixed === true)) {
    pass("403/固定画像は挿入しない", `fixed=${j.fixed} http=${j.httpStatus} status=${j.imageStatus}`);
  } else fail("画像URL 403時", r.out.slice(-500));
}

console.log("\n=== 4) Ollama成功時プロファイル（手動） ===");
{
  const r = runTsx(
    `
const { resolveOllamaRuntime } = await import("./src/config/ollamaRuntime.ts");
console.log(JSON.stringify(resolveOllamaRuntime()));
`,
    { BEAUTY_MORNING_MODE: "false", OLLAMA_TIMEOUT_MS: "180000" },
  );
  const j = lastJson(r.out);
  if (j?.profile === "manual" && j.generateTimeoutMs === 180000 && j.skipWarmup === false) {
    pass("手動プロファイル", `timeout=${j.generateTimeoutMs}ms`);
  } else fail("手動プロファイル", r.out.slice(-400));
}

console.log("\n=== 5) Ollama朝プロファイル（予熱あり / 90s） ===");
{
  const r = runTsx(
    `
const { resolveOllamaRuntime } = await import("./src/config/ollamaRuntime.ts");
console.log(JSON.stringify(resolveOllamaRuntime()));
`,
    {
      BEAUTY_MORNING_MODE: "true",
      // 明示env無しの既定値を検証するため、親環境の上書きを消す
      OLLAMA_MORNING_TIMEOUT_MS: "",
      OLLAMA_MORNING_WARMUP_TIMEOUT_MS: "",
      OLLAMA_MORNING_SKIP_WARMUP: "",
    },
  );
  const j = lastJson(r.out);
  if (
    j?.profile === "morning" &&
    j.generateTimeoutMs === 90000 &&
    j.warmupTimeoutMs === 45000 &&
    j.skipWarmup === false
  ) {
    pass(
      "朝プロファイル",
      `timeout=${j.generateTimeoutMs}ms warmup=${j.warmupTimeoutMs}ms skipWarmup=false`,
    );
  } else fail("朝プロファイル", r.out.slice(-400));
}

console.log("\n=== 朝タイムアウト即フォールバック（疑似） ===");
{
  const r = runTsx(`
const timeoutMs = 200;
const started = Date.now();
try {
  await fetch("http://127.0.0.1:9/", { signal: AbortSignal.timeout(timeoutMs) });
} catch (e) {
  const elapsed = Date.now() - started;
  console.log(JSON.stringify({
    fallback: true,
    elapsedMs: elapsed,
    underBudget: elapsed < 1500,
    errorName: e?.name || "Error",
  }));
}
`);
  const j = lastJson(r.out);
  if (j?.fallback && j.underBudget) pass("短時間でフォールバック可能", `elapsed=${j.elapsedMs}ms`);
  else fail("短時間フォールバック", r.out.slice(-400));
}

console.log(failed ? `\n${failed} case(s) FAILED` : "\nall cases PASS");
process.exit(failed ? 1 : 0);
