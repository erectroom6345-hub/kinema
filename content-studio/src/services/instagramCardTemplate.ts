/** ジャンル別配色と SVG テンプレ組み立て（Instagram 1080カード用） */

export type CardPalette = {
  bg1: string;
  bg2: string;
  accent: string;
  text: string;
  muted: string;
  labelBg: string;
};

const PALETTES: Record<string, CardPalette> = {
  メイク用品: {
    bg1: "#2A1F2E",
    bg2: "#5C3D4A",
    accent: "#E8B4B8",
    text: "#FFF8F6",
    muted: "#EAD5D3",
    labelBg: "#E8B4B8",
  },
  スキンケア: {
    bg1: "#1C2B2A",
    bg2: "#3D5C56",
    accent: "#A8D5C8",
    text: "#F4FFFB",
    muted: "#C9E4DC",
    labelBg: "#A8D5C8",
  },
  韓国コスメ: {
    bg1: "#241B33",
    bg2: "#4A3568",
    accent: "#D4B5FF",
    text: "#FBF0FF",
    muted: "#DCCEEF",
    labelBg: "#D4B5FF",
  },
  サプリ: {
    bg1: "#1A2433",
    bg2: "#35506B",
    accent: "#9EC5E8",
    text: "#F2F8FF",
    muted: "#C5D7EA",
    labelBg: "#9EC5E8",
  },
  特別ケア: {
    bg1: "#2B2418",
    bg2: "#6B5535",
    accent: "#E2C48A",
    text: "#FFF9EF",
    muted: "#E8D7B5",
    labelBg: "#E2C48A",
  },
};

const DEFAULT_PALETTE: CardPalette = {
  bg1: "#222022",
  bg2: "#4A4548",
  accent: "#D8C3B0",
  text: "#FFF9F4",
  muted: "#E5D6C9",
  labelBg: "#D8C3B0",
};

export function resolvePalette(genre: string): CardPalette {
  return PALETTES[genre.trim()] ?? DEFAULT_PALETTE;
}

export type CardContent = {
  title: string;
  pitch: string;
  genre: string;
  width?: number;
  height?: number;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 日本語想定の文字数折り返し */
export function wrapByChars(text: string, maxChars: number, maxLines: number): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const lines: string[] = [];
  let rest = clean;
  while (rest.length > 0 && lines.length < maxLines) {
    if (rest.length <= maxChars) {
      lines.push(rest);
      break;
    }
    lines.push(rest.slice(0, maxChars));
    rest = rest.slice(maxChars);
  }
  if (rest.length > 0 && lines.length === maxLines) {
    const last = lines[maxLines - 1] ?? "";
    lines[maxLines - 1] = `${last.slice(0, Math.max(0, maxChars - 1))}…`;
  }
  return lines;
}

/**
 * Instagram用正方形カードSVGを返す。
 * 背景はジャンル固定配色、文字で投稿差を出す。
 */
export function buildInstagramCardSvg(content: CardContent): string {
  const width = content.width ?? 1080;
  const height = content.height ?? 1080;
  const palette = resolvePalette(content.genre);
  const titleLines = wrapByChars(content.title || "Beauty Notes", 14, 4);
  const pitchLines = wrapByChars(content.pitch || "", 18, 3);
  const genreLabel = (content.genre || "Beauty").trim().slice(0, 12);

  const titleTs = titleLines
    .map((line, i) => {
      const y = 420 + i * 78;
      return `<text x="96" y="${y}" fill="${palette.text}" font-size="64" font-weight="600" font-family="Hiragino Sans, Hiragino Kaku Gothic ProN, Yu Gothic, Meiryo, sans-serif">${escapeXml(line)}</text>`;
    })
    .join("\n");

  const pitchStart = 420 + titleLines.length * 78 + 48;
  const pitchTs = pitchLines
    .map((line, i) => {
      const y = pitchStart + i * 48;
      return `<text x="96" y="${y}" fill="${palette.muted}" font-size="36" font-family="Hiragino Sans, Hiragino Kaku Gothic ProN, Yu Gothic, Meiryo, sans-serif">${escapeXml(line)}</text>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${palette.bg1}"/>
      <stop offset="100%" stop-color="${palette.bg2}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <circle cx="920" cy="160" r="180" fill="${palette.accent}" fill-opacity="0.14"/>
  <circle cx="120" cy="980" r="220" fill="${palette.accent}" fill-opacity="0.10"/>
  <rect x="96" y="120" width="280" height="56" rx="28" fill="${palette.labelBg}"/>
  <text x="236" y="158" text-anchor="middle" fill="${palette.bg1}" font-size="28" font-weight="700" font-family="Hiragino Sans, Hiragino Kaku Gothic ProN, Yu Gothic, Meiryo, sans-serif">${escapeXml(genreLabel)}</text>
  ${titleTs}
  ${pitchTs}
  <text x="96" y="980" fill="${palette.muted}" font-size="28" font-family="Hiragino Sans, Hiragino Kaku Gothic ProN, Yu Gothic, Meiryo, sans-serif">Beauty Notes</text>
</svg>`;
}
