#!/usr/bin/env node
/**
 * 困りごと辞書の各テーマを楽天で週次脈拍。
 * 勢いが出たら data/demand-candidates.json に pending を書く（自動approveしない）。
 *
 *   node scripts/run-demand-pulse.cjs
 *   node scripts/run-demand-pulse.cjs --dry-run
 *   node scripts/run-demand-pulse.cjs --theme=stinkbug
 */
require("dotenv").config();
const path = require("path");
const {
  loadDemandPolicy,
  loadPulseState,
  savePulseState,
  upsertCandidate,
  detectSurge,
  tokyoDayKey,
  tokyoMonth,
  pruneExpiredWindows,
  themeById,
} = require("./lib/demand-watch.cjs");
const { searchIchibaItems } = require("./lib/rakuten-ichiba.cjs");
const { sendNotify } = require("./lib/notify.cjs");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(argv) {
  const out = { dryRun: false, themeId: "", notify: true };
  for (const a of argv) {
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--no-notify") out.notify = false;
    else if (a.startsWith("--theme=")) out.themeId = a.slice("--theme=".length).trim();
  }
  return out;
}

function summarizeItems(items) {
  const list = Array.isArray(items) ? items : [];
  let reviewSum = 0;
  let reviewN = 0;
  const names = [];
  for (const it of list) {
    const rc = Number(it.reviewCount);
    if (Number.isFinite(rc) && rc >= 0) {
      reviewSum += rc;
      reviewN += 1;
    }
    if (names.length < 3 && it.itemName) names.push(String(it.itemName).slice(0, 40));
  }
  return { reviewSum, reviewN, sampleNames: names };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const policy = loadDemandPolicy();
  const pulseCfg = policy.pulse || {};
  const sleepMs = Number(pulseCfg.sleepMsBetweenRequests) || 1200;
  const hits = Math.min(30, Math.max(1, Number(pulseCfg.hitsPerTheme) || 5));
  const historyWeeks = Math.max(2, Number(pulseCfg.historyWeeks) || 8);
  const month = tokyoMonth();
  const day = tokyoDayKey();

  pruneExpiredWindows();

  let themes = policy.themes || [];
  if (args.themeId) {
    const t = themeById(policy, args.themeId);
    if (!t) throw new Error(`theme が見つかりません: ${args.themeId}`);
    themes = [t];
  }
  if (!themes.length) {
    console.log("[demand-pulse] themes が空です");
    return;
  }

  const state = loadPulseState();
  const newCandidates = [];
  const rows = [];

  for (const theme of themes) {
    const keyword = String(theme.pulseKeyword || "").trim();
    if (!keyword) {
      console.log(`[demand-pulse] skip ${theme.id}: pulseKeyword なし`);
      continue;
    }

    let apiCount = 0;
    let items = [];
    if (args.dryRun) {
      // ネットワーク無し: 既存最終サンプルを再評価するだけ
      const hist = state.themes?.[theme.id]?.history || [];
      const last = hist[hist.length - 1];
      if (last) {
        apiCount = Number(last.apiCount) || 0;
        items = (last.sampleNames || []).map((name) => ({
          itemName: name,
          reviewCount: Math.round((Number(last.reviewSum) || 0) / Math.max(1, last.sampleNames?.length || 1)),
        }));
      } else {
        console.log(`[demand-pulse] dry-run skip ${theme.id}: 履歴なし`);
        continue;
      }
    } else {
      const result = await searchIchibaItems({
        keyword,
        hits,
        sort: "-reviewCount",
      });
      apiCount = Number(result.count) || 0;
      items = result.items || [];
    }

    const sum = summarizeItems(items);
    const calendarMonths = Array.isArray(theme.calendarMonths)
      ? theme.calendarMonths.map(Number)
      : [];
    const calendarBoost = calendarMonths.includes(month);
    const sample = {
      at: new Date().toISOString(),
      day,
      apiCount,
      reviewSum: sum.reviewSum,
      reviewN: sum.reviewN,
      sampleNames: sum.sampleNames,
      calendarBoost,
      keyword,
    };

    const hist = Array.isArray(state.themes?.[theme.id]?.history)
      ? [...state.themes[theme.id].history]
      : [];
    const prev = hist.length ? hist[hist.length - 1] : null;
    // 同日再実行は prev を1つ前にずらす
    const prevForDetect =
      prev && String(prev.day) === day && hist.length >= 2
        ? hist[hist.length - 2]
        : prev && String(prev.day) === day
          ? null
          : prev;

    const detection = detectSurge(prevForDetect, sample, pulseCfg);
    rows.push({
      id: theme.id,
      title: theme.title,
      apiCount,
      reviewSum: sum.reviewSum,
      ratio: detection.ratio,
      surged: detection.surged,
      reason: detection.reason,
      calendarBoost,
    });

    if (!args.dryRun) {
      if (prev && String(prev.day) === day) {
        hist[hist.length - 1] = sample;
      } else {
        hist.push(sample);
      }
      while (hist.length > historyWeeks) hist.shift();
      state.themes[theme.id] = {
        title: theme.title,
        updatedAt: sample.at,
        history: hist,
        lastDetection: {
          surged: detection.surged,
          reason: detection.reason,
          ratio: detection.ratio,
        },
      };
    }

    if (detection.surged) {
      const candidate = {
        themeId: theme.id,
        title: theme.title,
        problem: theme.problem,
        genres: theme.genres || [],
        detectedAt: sample.at,
        day,
        reason: detection.reason,
        ratio: detection.ratio,
        apiCount,
        reviewSum: sum.reviewSum,
        sampleNames: sum.sampleNames,
        approveHint: `npm run demand:approve -- --theme=${theme.id}`,
        ingestHints: theme.ingestHints || [],
      };
      newCandidates.push(candidate);
      if (!args.dryRun) upsertCandidate(candidate);
    }

    console.log(
      `[demand-pulse] ${theme.id} count=${apiCount} reviews=${sum.reviewSum}` +
        ` surged=${detection.surged} (${detection.reason}` +
        `${detection.ratio != null ? ` ratio=${detection.ratio}` : ""})`,
    );

    if (!args.dryRun && sleepMs > 0) await sleep(sleepMs);
  }

  if (!args.dryRun) {
    state.updatedAt = new Date().toISOString();
    state.lastRunDay = day;
    savePulseState(state);
  }

  console.log(
    `[demand-pulse] done themes=${rows.length} candidates=${newCandidates.length}` +
      (args.dryRun ? " (dry-run)" : ""),
  );

  if (
    newCandidates.length &&
    args.notify &&
    policy.notifyOnCandidate !== false &&
    !args.dryRun
  ) {
    const lines = newCandidates.map(
      (c) =>
        `・${c.title} (${c.themeId}) reviews=${c.reviewSum} count=${c.apiCount}` +
        `\n  OK: npm run demand:approve -- --theme=${c.themeId}`,
    );
    await sendNotify({
      level: "warn",
      eventType: "demand_pulse_candidate",
      force: true,
      reason: `困りごと需要候補 ${newCandidates.length}件\n${lines.join("\n")}`,
    });
  }
}

main().catch((err) => {
  console.error(`[demand-pulse] FAIL ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
