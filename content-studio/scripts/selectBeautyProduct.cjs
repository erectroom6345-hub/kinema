const fs = require('fs');
const path = require('path');

const productsPath = path.join(__dirname, '..', 'input', 'products-beauty.json');
const postedPath = path.join(__dirname, '..', 'data', 'posted-beauty.json');
const articlePath = path.join(__dirname, '..', 'input', 'article.json');

function readJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function buildAffiliateNote(item) {
  const parts = [];
  if (item.labels?.sale) parts.push('セール対象');
  if (item.labels?.point) parts.push('ポイント対象');
  if (item.labels?.conditionalDeal) parts.push('条件次第でお得');
  if (item.labels?.detailCheck) parts.push('詳細は商品ページで確認');
  return parts.join('、');
}

function chooseItem(products, posted) {
  const groups = [
    ...(products.sale || []),
    ...(products.main || []),
    ...(products.niche || []),
    ...(products.routine || [])
  ];

  const unposted = groups.filter(item => !posted.includes(item.id));
  if (unposted.length > 0) return unposted[0];

  return null;
}

function toArticleJson(item) {
  const note = buildAffiliateNote(item);
  return {
    title: item.articleTitle,
    body: item.articleBody,
    product: {
      id: item.id,
      name: item.productName,
      brand: item.brand,
      category: item.category,
      genre: item.genre,
      url: item.productUrl,
      imageUrl: item.imageUrl,
      postType: item.postType
    },
    affiliateNote: note
  };
}

function main() {
  const products = readJson(productsPath, {});
  const posted = readJson(postedPath, []);

  const selected = chooseItem(products, posted);

  if (!selected) {
    console.log('投稿できる商品が見つかりませんでした');
    process.exit(1);
  }

  const article = toArticleJson(selected);
  writeJson(articlePath, article);

  const updatedPosted = [...new Set([...posted, selected.id])];
  writeJson(postedPath, updatedPosted);

  console.log('選択された商品:', selected.id);
  console.log('article.json を更新しました');
}

main();
