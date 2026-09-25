#!/bin/bash

cat > input/article.json <<'JSON'
{
  "imageUrl": "ここに画像URLを入れる",
  "articleTitle": "ここに記事タイトルを入れる",
  "articleBody": "ここに記事本文を入れる"
}
JSON

echo "input/article.json を更新しました"
