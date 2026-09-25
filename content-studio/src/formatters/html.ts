import type { ImageBundle, StockImage } from "../types/index.ts";

export function insertImages(markdown: string, images: ImageBundle): string {
  const withoutTitle = markdown.replace(/^# .+\n+/, "");
  const titleMatch = markdown.match(/^# .+$/m);
  const titleLine = titleMatch ? `${titleMatch[0]}\n\n` : "";
  const heroBlock = imageBlock(images.hero);
  const inlineStock = images.inline.find((image) => image.source !== "asp");
  const asp = images.inline.find((image) => image.source === "asp");

  const parts = splitByHeadings(withoutTitle);
  if (parts.length >= 3 && inlineStock?.url) {
    const mid = Math.floor(parts.length / 2);
    parts.splice(mid, 0, imageBlock(inlineStock));
  } else if (inlineStock?.url) {
    parts.push(imageBlock(inlineStock));
  }

  if (asp?.url) {
    parts.push(`## 紹介アイテムの参考画像\n\n${imageBlock(asp)}`);
  }

  return `${titleLine}${heroBlock}${parts.join("\n\n")}`.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function splitByHeadings(markdown: string): string[] {
  const chunks = markdown.split(/\n(?=## )/);
  return chunks.map((chunk) => chunk.trim()).filter(Boolean);
}

function imageBlock(image: StockImage): string {
  if (!image.url) return "";
  const credit = image.credit ? `\n\n*${image.credit}*` : "";
  return `![${escapeAlt(image.alt)}](${image.url})${credit}\n`;
}

function escapeAlt(value: string): string {
  return value.replace(/[[\]]/g, "");
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.split("\n");
  const html: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (image) {
      closeList();
      html.push(`<figure><img src="${escapeHtml(image[2])}" alt="${escapeHtml(image[1])}" /></figure>`);
      continue;
    }
    if (line.startsWith("# ")) {
      closeList();
      html.push(`<h1>${inline(line.slice(2))}</h1>`);
      continue;
    }
    if (line.startsWith("## ")) {
      closeList();
      html.push(`<h2>${inline(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith("- ")) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    if (line.startsWith("*") && line.endsWith("*")) {
      closeList();
      html.push(`<p><em>${escapeHtml(line.slice(1, -1))}</em></p>`);
      continue;
    }
    closeList();
    html.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return html.join("\n");
}

function inline(value: string): string {
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
