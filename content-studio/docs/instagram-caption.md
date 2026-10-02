# Instagram caption 運用メモ

`run-beauty.sh` → `src/generateInstagramCaption.ts` が生成経路。  
`product.postType` と `product.genre` を必ず読む。

## 誘導方針（重要）

- Instagramは**集客用**。バリューコマース等の**広告・商品ページ直リンクは貼らない**
- Instagram caption 末尾は **URLなし**。「詳しくは、プロフィールのリンクからご覧ください」のみ
- `blogUrl`（Blogger個別記事）は X / Threads 用。IG本文には付けない（JSONには保持）
  - ○ `https://beauty-diary-30s.blogspot.com/2026/09/記事スラッグ.html`
  - × `https://beauty-diary-30s.blogspot.com/`（ブログトップは不可）
- 自動取得: `run-beauty.sh` STEP2 `publishBeautyBlogger.ts` が未整備時に Blogger 公開し `product.blogUrl` へ書き戻す
- `productUrl` は商品ページ確認用（任意）。Instagram caption には使わない

## genre（商品タイプ）

| genre | 軸 |
|---|---|
| メイク用品 | 仕上がり・使いやすさ |
| スキンケア | 継続・心地よさ |
| 韓国コスメ | 話題性・チェック欲 |
| サプリ | 内側ケア・習慣 |
| 特別ケア | ご褒美感・丁寧さ |

商品タイプは崩さない。別ジャンルの話に寄せない。

## postType（補正）

| postType | 補正 |
|---|---|
| sale | 条件確認・お得感 |
| routine | 日常使い |
| main | 定番感・続けやすさ（啓発調にしない） |
| special | 特別感 |

`サプリ` × `main` は、毎日の習慣・取り入れやすさ・続けやすさを優先。

## 掘り出し物トーン

- genre とは別の**補助トーン**
- 毎回使わない（対象の一部だけ）
- 乗せてよい条件: sale / 韓国コスメ / 知名度が高すぎない良品
- 「見つけてうれしい」「早めに見ておきたい」を薄く。主役にしない

## ブランド名

- `[hince]` のような角括弧は使わない
- 文中で自然に: `hinceのアイテム` / `hinceらしい雰囲気` / `hinceで気になる一品`
- 1 caption あたり多くても 1〜2 回
- なくても自然なら入れない

## 改行正規化

- 本文に `\n`（バックスラッシュ+n）を残さない
- 共通関数: `src/utils/normalizeCaption.ts` の `normalizeCaption`
- **保存直前**（`generateInstagramCaption.ts`）と **投稿API直前**（`postInstagram.ts`）の両方で通す
- JSON ファイル上の `\n` 表示はエスケープ表記。実文字列は改行文字であること
