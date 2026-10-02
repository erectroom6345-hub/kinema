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

/** ブログトップ・仮値は不可。個別記事URLのみ可 */
function isUnusableBlogUrl(blogUrl) {
  const raw = (blogUrl || '').trim();
  if (!raw) return true;
  if (/example\.com(\/|$)/i.test(raw) || /YOURBLOG/i.test(raw) || /REPLACE-/i.test(raw)) {
    return true;
  }
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
    // パスが空 or "/" のみ = ブログトップ
    const path = (u.pathname || '/').replace(/\/+$/, '') || '/';
    if (path === '/') return true;
    return false;
  } catch {
    return true;
  }
}

function flattenProducts(products) {
  return {
    sale: products.sale || [],
    main: products.main || [],
    niche: products.niche || [],
    routine: products.routine || []
  };
}

function chooseItem(products, posted) {
  const groups = flattenProducts(products);
  const all = [
    ...groups.sale,
    ...groups.main,
    ...groups.niche,
    ...groups.routine
  ];

  const postedList = Array.isArray(posted) ? posted : [];
  const unposted = all.filter(item => !postedList.includes(item.id));
  if (unposted.length > 0) {
    return { item: unposted[0], recycled: false, remainingUnposted: unposted.length - 1 };
  }

  // 未投稿が尽きたら最古の投稿済みを再選択（朝の運用が止まらない最小ローテ）
  // 長期運用では products-beauty.json への商品追加を推奨
  if (all.length === 0) return { item: null, recycled: false, remainingUnposted: 0 };

  const byId = new Map(all.map(item => [item.id, item]));
  for (const id of postedList) {
    const hit = byId.get(id);
    if (hit) {
      return { item: hit, recycled: true, remainingUnposted: 0 };
    }
  }

  return { item: all[0], recycled: true, remainingUnposted: 0 };
}

function logEmptyCatalog() {
  console.error('=== 商品リストが空です ===');
  console.error(`参照: ${productsPath}`);
  console.error('対処: input/products-beauty.json に商品を追加してください');
}

function toArticleJson(item) {
  const note = buildAffiliateNote(item);
  const rawBlogUrl = (item.blogUrl || '').trim();
  const blogUrlUsable = !isUnusableBlogUrl(rawBlogUrl);
  // 不備でも選定は止めない（有効なときだけ caption 末尾に使う）
  if (!blogUrlUsable) {
    console.warn(
      `blogUrl 未整備 (id=${item.id}): ${rawBlogUrl || '(空)'} → URLなしで投稿続行します`
    );
  } else {
    console.log(`blogUrl 有効 (id=${item.id}): ${rawBlogUrl}`);
  }
  return {
    title: item.articleTitle,
    body: item.articleBody,
    product: {
      id: item.id,
      name: item.productName,
      brand: item.brand,
      category: item.category,
      genre: item.genre,
      // url は後方互換のため残す。Instagram誘導先は有効な blogUrl のみ
      url: item.productUrl || '',
      blogUrl: blogUrlUsable ? rawBlogUrl : '',
      imageUrl: item.imageUrl,
      postType: item.postType
    },
    affiliateNote: note
  };
}

function main() {
  const products = readJson(productsPath, {});
  const posted = readJson(postedPath, []);

  const { item: selected, recycled, remainingUnposted } = chooseItem(products, posted);

  if (!selected) {
    logEmptyCatalog();
    process.exit(1);
  }

  if (recycled) {
    console.warn('=== 未投稿在庫切れのためローテ再選択 ===');
    console.warn(`再選択ID: ${selected.id}`);
    console.warn(`参照: 商品=${productsPath} / 投稿済み=${postedPath}`);
    console.warn('運用メモ: 重複投稿を避けたい場合は products-beauty.json に未投稿商品を追加してください');
  }

  const article = toArticleJson(selected);
  writeJson(articlePath, article);

  // 投稿成功後にだけ posted-beauty.json へ記録する（ここでは更新しない）
  console.log('選択された商品:', selected.id);
  console.log('ローテ再選択:', recycled ? 'yes' : 'no');
  console.log('残り未投稿(概算):', remainingUnposted);
  console.log('article.json を更新しました');
}

main();
