/**
 * 商品カードPNGを縦型の短いスライド動画にする。
 * 曲は assets/reel-audio/*.mp3 を日付で1曲選ぶ。
 * linkUrl があるときだけ末尾に楽天QRカードを付ける（試し運用用）。
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const QRCode = require("qrcode");
const sharp = require("sharp");

const root = path.join(__dirname, "..", "..");
const audioDir = path.join(root, "assets", "reel-audio");

function ffmpegBin() {
  const fromEnv = String(process.env.FFMPEG_PATH || "").trim();
  if (fromEnv) return fromEnv;
  try {
    const bundled = require("ffmpeg-static");
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch {
    // fall through
  }
  return "ffmpeg";
}

function tokyoDayKey(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function listTracks() {
  if (!fs.existsSync(audioDir)) return [];
  return fs
    .readdirSync(audioDir)
    .filter((name) => /\.mp3$/i.test(name))
    .sort();
}

function pickTrack(dayKey) {
  const tracks = listTracks();
  if (!tracks.length) return null;
  const n = Number(String(dayKey || "").replace(/\D/g, "")) || 0;
  const file = tracks[n % tracks.length];
  return {
    file,
    path: path.join(audioDir, file),
    offsetSec: 8 + (n % 24),
  };
}

function run(bin, args) {
  try {
    execFileSync(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const stderr =
      error && error.stderr ? error.stderr.toString().slice(-800) : String(error);
    throw new Error(`ffmpeg失敗: ${stderr}`);
  }
}

function escapeXml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {{ linkUrl: string, productName?: string, outPath: string }} opts
 */
async function buildRakutenQrEndCard(opts) {
  const linkUrl = String(opts.linkUrl || "").trim();
  if (!/^https?:\/\//i.test(linkUrl)) {
    throw new Error("楽天QR用の linkUrl がありません");
  }
  const name = String(opts.productName || "商品").trim().slice(0, 28);
  const qrPng = await QRCode.toBuffer(linkUrl, {
    type: "png",
    width: 640,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#161311", light: "#F7F2EA" },
  });
  const qrB64 = qrPng.toString("base64");
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
  <rect width="1080" height="1920" fill="#161311"/>
  <text x="540" y="400" text-anchor="middle" fill="#F7F2EA" font-size="48" font-family="Hiragino Sans, sans-serif">楽天QRです</text>
  <text x="540" y="470" text-anchor="middle" fill="#C9B8A4" font-size="30" font-family="Hiragino Sans, sans-serif">${escapeXml(name)}</text>
  <image href="data:image/png;base64,${qrB64}" x="220" y="560" width="640" height="640"/>
  <text x="540" y="1320" text-anchor="middle" fill="#F7F2EA" font-size="34" font-family="Hiragino Sans, sans-serif">カメラで読み取ると楽天商品ページへ</text>
  <text x="540" y="1385" text-anchor="middle" fill="#C9B8A4" font-size="26" font-family="Hiragino Sans, sans-serif">※PR</text>
</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(opts.outPath);
  return opts.outPath;
}

/**
 * @param {{
 *   imagePaths: string[],
 *   outPath: string,
 *   dayKey?: string,
 *   linkUrl?: string,
 *   productName?: string,
 * }} opts
 * @returns {Promise<{ trackFile: string, outPath: string, seconds: number, qr: boolean }>}
 */
async function buildSlideReel(opts) {
  const images = (opts.imagePaths || []).filter((p) => p && fs.existsSync(p));
  if (!images.length) throw new Error("スライド画像がありません");
  const bin = ffmpegBin();
  const dayKey = opts.dayKey || tokyoDayKey();
  const track = pickTrack(dayKey);
  if (!track) {
    throw new Error(
      `BGMがありません。${audioDir} に Pixabay の mp3 を置いてください`,
    );
  }

  const linkUrl = String(opts.linkUrl || "").trim();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "slide-reel-"));
  const segments = [];
  let usedQr = false;

  try {
    const slideImages = [...images];
    if (/^https?:\/\//i.test(linkUrl)) {
      const qrPath = path.join(tmp, "rakuten-qr-end.png");
      await buildRakutenQrEndCard({
        linkUrl,
        productName: opts.productName,
        outPath: qrPath,
      });
      slideImages.push(qrPath);
      usedQr = true;
    }

    const framesEach = slideImages.length <= 1 ? 180 : 75;
    const fps = 30;
    const qrFrames = 120;

    for (let index = 0; index < slideImages.length; index += 1) {
      const image = slideImages[index];
      const isQr = usedQr && index === slideImages.length - 1;
      const frames = isQr ? qrFrames : framesEach;
      const seg = path.join(tmp, `seg-${index}.mp4`);
      const vf = isQr
        ? [
            "scale=1080:1920:force_original_aspect_ratio=decrease",
            "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x161311",
            `fps=${fps}`,
            `trim=end_frame=${frames}`,
            "setpts=PTS-STARTPTS",
            "format=yuv420p",
          ].join(",")
        : [
            "scale=2160:2160:force_original_aspect_ratio=increase",
            "crop=2160:2160",
            `zoompan=z='1+0.08*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1080:fps=${fps}`,
            "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x161311",
            "format=yuv420p",
          ].join(",");
      run(bin, [
        "-y",
        "-loop",
        "1",
        "-i",
        image,
        "-vf",
        vf,
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-t",
        String(frames / fps),
        "-r",
        String(fps),
        seg,
      ]);
      segments.push(seg);
    }

    const listPath = path.join(tmp, "list.txt");
    fs.writeFileSync(
      listPath,
      segments.map((seg) => `file '${seg.replace(/'/g, "'\\''")}'`).join("\n"),
      "utf8",
    );
    const silent = path.join(tmp, "silent.mp4");
    run(bin, [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      silent,
    ]);

    fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
    run(bin, [
      "-y",
      "-i",
      silent,
      "-ss",
      String(track.offsetSec),
      "-i",
      track.path,
      "-filter:a",
      "volume=0.28",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-shortest",
      "-movflags",
      "+faststart",
      opts.outPath,
    ]);

    const totalFrames =
      framesEach * (slideImages.length - (usedQr ? 1 : 0)) + (usedQr ? qrFrames : 0);
    return {
      trackFile: track.file,
      outPath: opts.outPath,
      seconds: totalFrames / fps,
      qr: usedQr,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = {
  buildSlideReel,
  buildRakutenQrEndCard,
  pickTrack,
  tokyoDayKey,
  ffmpegBin,
};
