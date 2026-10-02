const fs = require('fs');
const path = require('path');

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

const rawBlogUrl = (article.product?.blogUrl || '').trim();
const blogUrlUsable = !isUnusableBlogUrl(rawBlogUrl);
const blogUrl = blogUrlUsable ? rawBlogUrl : '';

insta.blogUrl = blogUrl;
insta.productUrl = article.product?.url || '';
insta.productName = article.product?.name || '';
insta.brand = article.product?.brand || '';
insta.genre = article.product?.genre || '';
insta.postType = article.product?.postType || '';

// テンプレカード生成済みなら imageUrl を上書きしない（VC/固定1枚運用しない）
if (insta.imageSource !== 'template-card') {
  insta.imageUrl = article.product?.imageUrl || '';
}

writeJson(instaPath, insta);

console.log('instagram-post.json に imageUrl / blogUrl などを補完しました');
if (insta.imageSource === 'template-card') {
  console.log('画像モード: template-card / imageUrl=', insta.imageUrl);
} else {
  console.log('画像モード: article.imageUrl / imageUrl=', insta.imageUrl || '(空)');
}
if (blogUrlUsable) {
  console.log('投稿モード: URLあり / blogUrl=', blogUrl);
} else {
  console.log('投稿モード: URLなし / blogUrl未整備=', rawBlogUrl || '(空)');
}
