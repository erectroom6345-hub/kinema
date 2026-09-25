#!/bin/bash

set -a
source .env
set +a

set -e

echo "美容商品の選択を開始します..."
node scripts/selectBeautyProduct.cjs

echo "article.json の内容を確認します..."
cat input/article.json

echo "Instagram caption を生成します..."
npx tsx src/generateInstagramCaption.ts

echo "instagram-post.json を補完します..."
node scripts/prepareInstagramPost.cjs

echo "instagram-post.json の内容を確認します..."
cat input/instagram-post.json

echo "Instagram に投稿します..."
npx tsx src/postInstagram.ts
