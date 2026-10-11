/**
 * 美容アカウント専用の SNS 文面テンプレ。
 * 投稿型3パターン（選び方 / 比較 / これだけ見れば）を日次でローテ。
 */

import {
  buildPatternInstagramCaption,
  buildPatternThreadsBody,
  patternLabel,
  pickBeautyPostPattern,
  type BeautyPostPatternId,
} from "./beautyPostPatterns.ts";

export type BeautySocialCopyInput = {
  brand: string;
  productName: string;
  genre: string;
  title?: string;
  body?: string;
  productId?: string;
  /** 省略時は日付ローテで自動選択 */
  pattern?: BeautyPostPatternId;
};

export function resolveBeautyPostPattern(
  input: BeautySocialCopyInput,
): BeautyPostPatternId {
  if (input.pattern) return input.pattern;
  return pickBeautyPostPattern({ productId: input.productId });
}

/**
 * Instagram 用（自然な商品紹介。URLなし）
 */
export function buildBeautyInstagramCaption(input: BeautySocialCopyInput): string {
  const pattern = resolveBeautyPostPattern(input);
  return buildPatternInstagramCaption(pattern, input);
}

/**
 * Threads 用（短め。URLは呼び出し側で付与）
 */
export function buildBeautyThreadsBody(input: BeautySocialCopyInput): string {
  const pattern = resolveBeautyPostPattern(input);
  return buildPatternThreadsBody(pattern, input);
}

export function describeBeautyPostPattern(input: BeautySocialCopyInput): {
  id: BeautyPostPatternId;
  label: string;
} {
  const id = resolveBeautyPostPattern(input);
  return { id, label: patternLabel(id) };
}
