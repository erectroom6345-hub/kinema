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

const article = readJson(articlePath);
const insta = readJson(instaPath);

insta.imageUrl = article.product?.imageUrl || '';
insta.productUrl = article.product?.url || '';
insta.productName = article.product?.name || '';
insta.brand = article.product?.brand || '';
insta.genre = article.product?.genre || '';
insta.postType = article.product?.postType || '';

writeJson(instaPath, insta);

console.log('instagram-post.json に imageUrl などを補完しました');
