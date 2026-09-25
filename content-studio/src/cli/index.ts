import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { getConfig, loadEnv } from "../config/env.ts";
import { runPipeline } from "../services/pipeline.ts";
import { selectInstagramImage } from "../services/instagramImage.ts";
import {
  buildPlannedImageRefs,
  findMissingSocialDrafts,
  formatImageMetadataJson,
  formatInstagramBodyText,
  formatPostingSummaryMarkdown,
  formatPublicPreview,
  formatRunStamp,
  formatSocialDraftsMarkdown,
  formatSocialPreview,
  formatThreadsBodyText,
  formatXBodyText,
  getPublicBodyText,
  toMarkdownPreview,
} from "../formatters/outputs.ts";
import { logger } from "../utils/logger.ts";
import { toErrorMessage } from "../utils/errors.ts";
import type { ArticleJobInput } from "../types/index.ts";

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  loadEnv();
  const config = getConfig();
  const { values } = parseArgs({
    args: argv,
    options: {
      input: { type: "string", short: "i" },
      topic: { type: "string" },
      title: { type: "string" },
      body: { type: "string" },
      genre: { type: "string" },
      "blog-name": { type: "string" },
      "blog-url": { type: "string" },
      "article-url": { type: "string" },
      pr: { type: "boolean", default: false },
      "publish-date": { type: "string" },
      format: { type: "string", default: "public" },
      out: { type: "string" },
      "skip-images": { type: "boolean", default: false },
      "save-full": { type: "boolean", default: true },
    },
  });

  try {
    const input = await loadInput(values);
    const result = await runPipeline(input, { skipImages: Boolean(values["skip-images"]) });
    const outDir = values.out ? resolve(values.out) : resolve(process.cwd(), "output");
    await mkdir(outDir, { recursive: true });

    const stamp = slug(result.input_summary.topic || result.blog_draft.title);
    const publicBody = getPublicBodyText(result);
    const imagesJson = formatImageMetadataJson(result.images);
    const socialMd = formatSocialDraftsMarkdown(result.outputs, result.input_summary.topic);

    const missingSocial = findMissingSocialDrafts(result.outputs);
    for (const name of missingSocial) {
      logger.debug(`social draft missing: ${name}`);
    }

    const publicPath = resolve(outDir, `${stamp}-public.md`);
    const imagesPath = resolve(outDir, `${stamp}-images.json`);
    const socialPath = resolve(outDir, `${stamp}-social.md`);

    await writeFile(publicPath, publicBody, "utf8");
    await writeFile(imagesPath, imagesJson, "utf8");
    await writeFile(socialPath, socialMd, "utf8");

    // 互換用の別名
    await writeFile(resolve(outDir, `${stamp}.public.txt`), publicBody, "utf8");
    await writeFile(resolve(outDir, `${stamp}.images.json`), imagesJson, "utf8");

    if (values["save-full"] !== false) {
      await writeFile(resolve(outDir, `${stamp}.json`), JSON.stringify(result, null, 2), "utf8");
      await writeFile(resolve(outDir, `${stamp}-internal.md`), toMarkdownPreview(result), "utf8");
    }

    // Instagram / Threads / X 投稿用（実行日時ベース・既存結果を再利用）
    const generatedAt = new Date();
    const runStamp = formatRunStamp(generatedAt);
    const igBody = formatInstagramBodyText(result.outputs);
    const threadsBody = formatThreadsBodyText(result.outputs);
    const xBody = formatXBodyText(result.outputs);
    const instagramImage = await selectInstagramImage({
      approvedDir: config.instagramApprovedDir,
      fixedImage: config.instagramFixedImage,
      matchKeys: [
        input.instagram_image_key,
        result.input_summary.topic,
        result.input_summary.article_title,
      ],
      cwd: process.cwd(),
    });
    const plannedImages = buildPlannedImageRefs(result.images, outDir, runStamp);

    const summaryName = `${runStamp}-summary.md`;
    const igName = `${runStamp}-instagram.txt`;
    const threadsName = `${runStamp}-threads.txt`;
    const xName = `${runStamp}-x.txt`;
    const summaryPath = resolve(outDir, summaryName);
    const igPath = resolve(outDir, igName);
    const threadsPath = resolve(outDir, threadsName);
    const xPath = resolve(outDir, xName);

    const postingFileNames = [summaryName, igName, threadsName, xName];
    const savedFileNames = [
      `${stamp}-public.md`,
      `${stamp}-images.json`,
      `${stamp}-social.md`,
      ...postingFileNames,
    ];
    const summaryMd = formatPostingSummaryMarkdown({
      result,
      generatedAt,
      savedFileNames,
      plannedImages,
      instagramImage,
    });

    await writeFile(summaryPath, summaryMd, "utf8");
    await writeFile(igPath, igBody, "utf8");
    await writeFile(threadsPath, threadsBody, "utf8");
    await writeFile(xPath, xBody, "utf8");

    const format = normalizeFormat(values.format);
    if (format === "json") {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(`保存ファイル\n`);
      process.stdout.write(`- public: ${publicPath}\n`);
      process.stdout.write(`- images: ${imagesPath}\n`);
      process.stdout.write(`- social: ${socialPath}\n`);
      process.stdout.write(`- summary: ${summaryPath}\n`);
      process.stdout.write(`- instagram: ${igPath}\n`);
      process.stdout.write(`- threads: ${threadsPath}\n`);
      process.stdout.write(`- x: ${xPath}\n`);
      process.stdout.write(`- instagram-image-mode: ${instagramImage.mode}\n`);
      process.stdout.write(`- instagram-image: ${instagramImage.fileName}\n`);
      process.stdout.write(`- instagram-image-reason: ${instagramImage.reason}\n`);
      process.stdout.write(`- instagram-image-path: ${instagramImage.path}\n`);
      process.stdout.write(`\n`);
      process.stdout.write(`public preview\n`);
      process.stdout.write(`${formatPublicPreview(result)}\n`);
      process.stdout.write(`\n`);
      process.stdout.write(`social preview\n`);
      process.stdout.write(`${formatSocialPreview(result.outputs)}\n`);
      process.stdout.write(`\n`);
      process.stdout.write(`完了しました\n`);
    }

    logger.debug("出力パス", {
      public: publicPath,
      images: imagesPath,
      social: socialPath,
      summary: summaryPath,
      instagram: igPath,
      threads: threadsPath,
      x: xPath,
      instagramImage,
    });
    return 0;
  } catch (error) {
    logger.error("CLI failed", toErrorMessage(error));
    return 1;
  }
}

async function loadInput(values: Record<string, string | boolean | undefined>): Promise<ArticleJobInput> {
  if (typeof values.input === "string") {
    const raw = await readFile(resolve(values.input), "utf8");
    return JSON.parse(raw) as ArticleJobInput;
  }
  return {
    topic: stringOpt(values.topic),
    article_title: stringOpt(values.title),
    article_body: stringOpt(values.body),
    genre: stringOpt(values.genre),
    blog_name: stringOpt(values["blog-name"]),
    blog_url: stringOpt(values["blog-url"]),
    article_url: stringOpt(values["article-url"]),
    is_pr: Boolean(values.pr),
    publish_date: stringOpt(values["publish-date"]),
  };
}

function stringOpt(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeFormat(value: string | boolean | undefined): "public" | "json" {
  if (value === "json") return "json";
  return "public";
}

function slug(value: string): string {
  return (
    value
      .slice(0, 40)
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "draft"
  );
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("src/cli/index.ts") || entry.endsWith("cli/index.ts")) {
  runCli().then((code) => process.exit(code));
}
