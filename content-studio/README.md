# content-studio

Blogger向けの記事下書きと、Instagram / Threads / X の投稿下書きをまとめて作る半自動ツールです。画像は Pixabay のフリー素材を優先して取得し、取得失敗時も本文生成は続行します。

## できること

- テーマ入力、または `article_title` / `article_body` の直接入力
- タイトル案・構成案・本文ドラフト生成
- 商品紹介向き / 悩み整理向きの判定
- 画像キーワード生成とアイキャッチ / 挿入画像の選定
- Instagram 1案、Threads 3案、X 1週間分（7本）
- JSON と Markdown プレビューの同時出力

`runPipeline()` は CLI からも、将来の Webhook / Cursor Automations からも同じ入口で呼べます。Blogger API への下書き保存は `BloggerClient` インターフェースのみ用意しています。

## セットアップ

```bash
cd content-studio
npm install
cp .env.example .env
```

`.env` に `PIXABAY_API_KEY` を入れてください。本文生成の既定はローカル Ollama（`gemma3:4b`）です。`OPENAI_API_KEY` は `LLM_PROVIDER=openai` のときだけ必要です。

```env
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma3:4b
```

## 実行

Ollama を起動し、モデルを用意してから実行します。

```bash
ollama serve
ollama pull gemma3:4b
cd content-studio
npm start -- --input samples/beauty-input.json
```

その他の例:

```bash
npm start -- --input samples/beauty-with-body.json --format markdown
npm start -- --topic "ゆらぎ肌の日の導入美容液" --genre beauty --blog-name "Beauty Notes" --pr
```

結果は標準出力に加え、`output/*.json` と `output/*.md` に保存されます。画像取得を飛ばす場合は `--skip-images` を付けます。

## テスト

```bash
npm test
npm run typecheck
```
