import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { selectInstagramImage, toImageMatchKey } from "../src/services/instagramImage.ts";

test("許可済み商品画像があれば product を返す", async () => {
  const root = await mkdtemp(join(tmpdir(), "ig-approved-"));
  const approvedDir = join(root, "approved");
  await mkdir(approvedDir, { recursive: true });
  await writeFile(join(approvedDir, "serum-habit.jpg"), "fake");

  const selected = await selectInstagramImage({
    approvedDir,
    fixedImage: join(root, "instagram-fixed.jpg"),
    matchKeys: ["serum-habit"],
    cwd: root,
  });

  assert.equal(selected.mode, "product");
  assert.equal(selected.fileName, "serum-habit.jpg");
  assert.equal(selected.reason, "approved product image found");
  assert.equal(selected.path, join(approvedDir, "serum-habit.jpg"));
});

test("一致しなければ fixed にフォールバックする", async () => {
  const root = await mkdtemp(join(tmpdir(), "ig-fixed-"));
  const approvedDir = join(root, "approved");
  await mkdir(approvedDir, { recursive: true });
  await writeFile(join(approvedDir, "other-product.png"), "fake");

  const selected = await selectInstagramImage({
    approvedDir,
    fixedImage: "assets/instagram-fixed.jpg",
    matchKeys: ["missing-key", "ゆらぎ肌"],
    cwd: root,
  });

  assert.equal(selected.mode, "fixed");
  assert.equal(selected.fileName, "instagram-fixed.jpg");
  assert.equal(selected.reason, "fallback to fixed image");
  assert.equal(selected.path, join(root, "assets/instagram-fixed.jpg"));
});

test("許可済みフォルダ外の画像は参照しない", async () => {
  const root = await mkdtemp(join(tmpdir(), "ig-outside-"));
  const approvedDir = join(root, "approved");
  const outsideDir = join(root, "unknown");
  await mkdir(approvedDir, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  await writeFile(join(outsideDir, "serum-habit.jpg"), "fake");

  const selected = await selectInstagramImage({
    approvedDir,
    fixedImage: "instagram-fixed.jpg",
    matchKeys: ["serum-habit"],
    cwd: root,
  });

  assert.equal(selected.mode, "fixed");
  assert.equal(selected.reason, "fallback to fixed image");
});

test("照合キーを正規化できる", () => {
  assert.equal(toImageMatchKey("Serum Habit.jpg"), "serum-habit");
  assert.equal(toImageMatchKey("  ゆらぎ肌の整え方  "), "ゆらぎ肌の整え方");
});
