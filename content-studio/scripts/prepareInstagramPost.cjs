const fs = require('fs');
const path = require('path');
const { withInstagramBeautyUtm, describeUtm, normalizePipelineGenre } = require('./lib/utm.cjs');

const articlePath = path.join(__dirname, '..', 'input', 'article.json');
const instaPath = path.join(__dirname, '..', 'input', 'instagram-post.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/** ブログトップ・仮値は誘導先に使わない */
function isUnusableBlogUrl(url) {
  const raw = (url || '').trim();
  if (!raw) return true;
  if (/example\.com(\/|$)/i.test(raw) || /YOURBLOG/i.test(raw) || /REPLACE-/i.test(raw)) return true;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
    const pathname = (u.pathname || '/').replace(/\/+$/, '') || '/';
    return pathname === '/';
  } catch {
    return true;
  }
}

const article = readJson(articlePath);
const insta = readJson(instaPath);

const rawBlogUrl = (article.product?.blogUrl || insta.blogUrl || '').trim();
const pipelineGenre = normalizePipelineGenre(
  article.pipelineGenre ||
    article.product?.pipelineGenre ||
    article.product?.genre ||
    insta.genre ||
    process.env.CONTENT_PIPELINE_GENRE,
);
// living/drink は SNS完結。food/gadget は通常SNS完結だが、備蓄期間だけ blogUrl を残す。
const isTip = String(article.product?.postType || insta.postType || '') === 'tip';
const stockpileBlog =
  (pipelineGenre === 'food' || pipelineGenre === 'gadget') &&
  (insta.stockpilePeriod === true ||
    insta.cta === 'stockpile_blog' ||
    String(process.env.FOOD_STOCKPILE_MODE || '').toLowerCase() === 'true' ||
    String(process.env.GADGET_STOCKPILE_MODE || '').toLowerCase() === 'true');
const snsSelfContained =
  pipelineGenre === 'living' ||
  pipelineGenre === 'drink' ||
  ((pipelineGenre === 'food' || pipelineGenre === 'gadget') && !stockpileBlog);
const effectiveBlogUrl =
  snsSelfContained || isTip
    ? ''
    : stockpileBlog
      ? insta.blogUrl || rawBlogUrl
      : rawBlogUrl;
const blogUrlUsable = !isUnusableBlogUrl(effectiveBlogUrl);
const blogUrl = blogUrlUsable ? effectiveBlogUrl : '';
const productId = (article.product?.id || '').trim();
const blogUtmUrl =
  blogUrlUsable && productId
    ? withInstagramBeautyUtm(blogUrl, productId, { genre: pipelineGenre })
    : (insta.blogUtmUrl || '');

insta.blogUrl = blogUrl;
insta.blogUtmUrl = blogUtmUrl || '';
insta.productUrl = article.product?.url || '';
insta.productName = article.product?.name || '';
insta.brand = article.product?.brand || '';
insta.genre = article.product?.genre || '';
insta.postType = article.product?.postType || '';

// 生成済みカード（美容テンプレ / living 商品写真先頭カルーセル）は上書きしない
const keepGeneratedImages =
  insta.imageSource === 'template-card' ||
  insta.imageSource === 'product-first-carousel' ||
  (Array.isArray(insta.imageUrls) &&
    insta.imageUrls.length > 0 &&
    /instagram-cards\//i.test(String(insta.imageUrl || insta.imageUrls[0] || '')));
if (!keepGeneratedImages) {
  insta.imageUrl = article.product?.imageUrl || '';
  if (Array.isArray(insta.imageUrls)) delete insta.imageUrls;
  if (insta.mediaType) delete insta.mediaType;
}

// 任意: caption 末尾に Instagram UTM URL を付ける
if (
  blogUtmUrl &&
  String(process.env.INSTAGRAM_CAPTION_BLOG_UTM || '').toLowerCase() === 'true'
) {
  const caption = String(insta.caption || '');
  if (!caption.includes(blogUtmUrl)) {
    insta.caption = `${caption.replace(/\s+$/, '')}\n${blogUtmUrl}`;
  }
}

writeJson(instaPath, insta);

console.log('instagram-post.json に imageUrl / blogUrl / blogUtmUrl などを補完しました');
if (keepGeneratedImages) {
  const n = Array.isArray(insta.imageUrls) ? insta.imageUrls.length : 1;
  console.log(
    '画像モード:',
    insta.imageSource || 'generated',
    '/ mediaType=',
    insta.mediaType || 'image',
    '/ slides=',
    n,
    '/ imageUrl=',
    insta.imageUrl,
  );
} else {
  console.log('画像モード: article.imageUrl / imageUrl=', insta.imageUrl || '(空)');
}
if (isTip) {
  console.log('投稿モード: beauty_tip（URLなし。ブログ誘導なし）');
} else if (stockpileBlog) {
  console.log('投稿モード: stockpile_blog（備蓄期間。Threads/X にブログURL）');
} else if (snsSelfContained) {
  console.log('投稿モード: sns_self_contained（blog誘導なし。blog誘導は美容のみ）');
} else if (blogUrlUsable) {
  console.log('---- Instagram Blogger UTM ----');
  console.log('productId:', productId || '-');
  console.log('pipelineGenre:', pipelineGenre);
  console.log('channel: instagram');
  console.log('生成前URL:', blogUrl);
  console.log('生成後URL:', blogUtmUrl || '(なし)');
  console.log('付与utm:', JSON.stringify(describeUtm(blogUtmUrl)));
} else {
  console.log('投稿モード: URLなし / blogUrl未整備=', rawBlogUrl || '(空)');
}
