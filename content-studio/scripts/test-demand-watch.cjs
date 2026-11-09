#!/usr/bin/env node
/**
 * demand-watch 単体テスト（楽天APIなし）
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  loadDemandPolicy,
  isDemandProduct,
  detectSurge,
  approveTheme,
  clearTheme,
  listActiveThemesForGenre,
  pickDemandFromPool,
  addDays,
} = require("./lib/demand-watch.cjs");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "demand-watch-"));
const activePath = path.join(tmp, "active.json");
const candidatesPath = path.join(tmp, "candidates.json");

function pickBest(list) {
  return list[0] || null;
}
function normalizeCategory(cat) {
  return String(cat || "other");
}

function main() {
  const policy = loadDemandPolicy();
  assert.ok(policy.themes.length >= 5, "dictionary themes");

  const stink = policy.themes.find((t) => t.id === "stinkbug");
  assert.ok(stink, "stinkbug theme");
  assert.ok(
    isDemandProduct({ name: "カメムシ忌避スプレー 屋外用" }, stink),
    "pattern match",
  );
  assert.ok(
    !isDemandProduct({ name: "キッチン水切りカゴ" }, stink),
    "pattern miss",
  );

  const floor = detectSurge(
    null,
    { reviewSum: 10, apiCount: 5, calendarBoost: false },
    policy.pulse,
  );
  assert.equal(floor.surged, false, "first weak sample");

  const baseline = detectSurge(
    null,
    { reviewSum: 200, apiCount: 100, calendarBoost: true },
    policy.pulse,
  );
  assert.equal(baseline.surged, false, "first sample never surges");
  assert.equal(baseline.reason, "baseline_only");

  const ratio = detectSurge(
    { reviewSum: 100, apiCount: 40 },
    { reviewSum: 200, apiCount: 80, calendarBoost: false },
    { ...policy.pulse, surgeRatio: 1.35, minReviewSum: 80 },
  );
  assert.equal(ratio.surged, true, "ratio surge");
  assert.ok(ratio.ratio >= 1.35, "ratio value");

  const soft = detectSurge(
    { reviewSum: 100, apiCount: 40 },
    { reviewSum: 125, apiCount: 50, calendarBoost: true },
    { ...policy.pulse, surgeRatio: 1.35, minReviewSum: 80 },
  );
  assert.equal(soft.surged, true, "calendar softens ratio a bit");
  assert.equal(soft.reason, "calendar_soft_ratio");

  const approved = approveTheme("stinkbug", {
    activePath,
    candidatesPath,
    today: "2026-10-30",
    days: 14,
  });
  assert.equal(approved.window.start, "2026-10-30");
  assert.equal(approved.window.end, addDays("2026-10-30", 14));

  const living = listActiveThemesForGenre("living", {
    activePath,
    today: "2026-11-05",
  });
  assert.equal(living.length, 1);
  assert.equal(living[0].theme.id, "stinkbug");

  const foodNone = listActiveThemesForGenre("food", {
    activePath,
    today: "2026-11-05",
  });
  assert.equal(foodNone.length, 0, "genre filter");

  const hit = pickDemandFromPool(
    [
      { id: "a", name: "普通のモップ", category: "cleaning" },
      { id: "b", name: "カメムシ駆除スプレー", category: "other" },
    ],
    "living",
    { categories: ["other", "cleaning"] },
    pickBest,
    normalizeCategory,
    { activePath, today: "2026-11-05", scheduled: "kitchen" },
  );
  assert.ok(hit, "pick demand");
  assert.equal(hit.item.id, "b");
  assert.equal(hit.theme.id, "stinkbug");

  const cleared = clearTheme("stinkbug", { activePath });
  assert.equal(cleared.removed, 1);
  assert.equal(
    listActiveThemesForGenre("living", { activePath, today: "2026-11-05" })
      .length,
    0,
  );

  console.log("test-demand-watch: OK");
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
