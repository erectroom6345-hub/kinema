import { readdir } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import {
  resolveInstagramFixedImage,
  type InstagramFixedImageRef,
} from "../formatters/outputs.ts";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

export type InstagramImageMode = "product" | "fixed";

export type InstagramImageReason =
  | "approved product image found"
  | "fallback to fixed image";

export interface InstagramImageSelection {
  mode: InstagramImageMode;
  fileName: string;
  path: string;
  reason: InstagramImageReason;
}

/** 許可済みフォルダのみ見て、見つかれば product、なければ fixed（保留なし） */
export async function selectInstagramImage(params: {
  approvedDir: string;
  fixedImage: string;
  matchKeys: Array<string | undefined>;
  cwd?: string;
}): Promise<InstagramImageSelection> {
  const cwd = params.cwd ?? process.cwd();
  const fixed = resolveInstagramFixedImage(params.fixedImage, cwd);
  const approvedRoot = resolvePath(cwd, params.approvedDir.trim() || "assets/instagram-approved");
  const keys = uniqueKeys(params.matchKeys);
  const approvedFiles = await listApprovedImages(approvedRoot);

  for (const key of keys) {
    const hit = findApprovedMatch(approvedFiles, key);
    if (!hit) continue;
    return {
      mode: "product",
      fileName: hit.fileName,
      path: hit.path,
      reason: "approved product image found",
    };
  }

  return toFixedSelection(fixed);
}

export function toFixedSelection(fixed: InstagramFixedImageRef): InstagramImageSelection {
  return {
    mode: "fixed",
    fileName: fixed.fileName,
    path: fixed.path,
    reason: "fallback to fixed image",
  };
}

export function toImageMatchKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "");
}

async function listApprovedImages(approvedRoot: string): Promise<Array<{ fileName: string; path: string; stem: string }>> {
  let entries: string[] = [];
  try {
    entries = await readdir(approvedRoot);
  } catch {
    return [];
  }

  return entries
    .filter((name) => IMAGE_EXTENSIONS.has(extname(name).toLowerCase()))
    .map((fileName) => ({
      fileName,
      path: resolve(approvedRoot, fileName),
      stem: toImageMatchKey(basename(fileName, extname(fileName))),
    }))
    .filter((item) => item.stem.length > 0);
}

function findApprovedMatch(
  files: Array<{ fileName: string; path: string; stem: string }>,
  rawKey: string,
): { fileName: string; path: string } | undefined {
  const key = toImageMatchKey(rawKey);
  if (!key) return undefined;

  const exactName = files.find((file) => file.fileName.toLowerCase() === rawKey.trim().toLowerCase());
  if (exactName) return exactName;

  return files.find((file) => file.stem === key || file.stem.startsWith(`${key}-`));
}

function uniqueKeys(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value?.trim()) continue;
    const normalized = toImageMatchKey(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value.trim());
  }
  return result;
}

function resolvePath(cwd: string, value: string): string {
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return value;
  return resolve(cwd, value);
}
