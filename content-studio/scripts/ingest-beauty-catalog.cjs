#!/usr/bin/env node
/**
 * 美容カタログ自動補充 CLI
 *
 *   node scripts/ingest-beauty-catalog.cjs
 *   node scripts/ingest-beauty-catalog.cjs --dry-run
 *   BEAUTY_INGEST_PROMOTE=false node scripts/ingest-beauty-catalog.cjs
 */
const {
  runBeautyCatalogIngest,
} = require("./lib/beauty-catalog-ingest.cjs");

function hasFlag(name) {
  return process.argv.includes(name);
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const force = hasFlag("--force");
  const result = await runBeautyCatalogIngest({ dryRun, force });

  if (result.skipped) {
    console.log(`[beauty-ingest] skipped reason=${result.reason}`);
    process.exit(0);
  }

  console.log(
    `[beauty-ingest] dryRun=${result.dryRun}` +
      ` discovered=${result.discovered}` +
      ` enriched=${result.enriched}` +
      ` ready=${result.ready}` +
      ` needsReview=${result.needsReview}` +
      ` rejected=${result.rejected}` +
      ` promoted=${result.promoted.length}` +
      ` promotedBuckets=${JSON.stringify(result.promotedBuckets || {})}` +
      ` promoteReady=${result.promoteReady}`,
  );
  if (result.promoted.length) {
    console.log(`[beauty-ingest] promotedIds=${result.promoted.join(",")}`);
  }
  console.log(
    `[beauty-ingest] queue=` +
      `total=${result.queueSummary.total}` +
      ` ready=${result.queueSummary.ready || 0}` +
      ` needsReview=${result.queueSummary.needsReview || 0}` +
      ` rejected=${result.queueSummary.rejected || 0}` +
      ` promoted=${result.queueSummary.promoted || 0}`,
  );
  for (const log of result.discoverLogs || []) {
    console.log(
      `[beauty-ingest:brand] brand=${log.brand} found=${log.found}`,
    );
  }

  // 朝ランは失敗でも止めない想定。CLI 単体は発見0でも exit 0。
  process.exit(0);
}

main().catch((err) => {
  console.error(`[beauty-ingest] FAIL ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
