# すいちゃん - 自立型軽貨物女子エージェント

GitHub Actionsで1日7回自動投稿する、軽貨物ドライバー「すいちゃん」のX/Twitterボットです。

## 概要

- **キャラクター**: すいちゃん（23歳、大久保在住、Amazon系軽貨物ドライバー）
- **投稿頻度**: 1日7回（GitHub Actions cron）
- **画像投稿**: 月次で10%の割合で画像投稿（動的調整）
- **AI生成**: OpenAI gpt-4o-mini（Structured Outputs使用）
- **フォールバック**: OpenAI障害時はローカル定型文プールから投稿

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

ローカル実行時は `.env` ファイルを作成：

```bash
cp .env.example .env
```

```env
OPENAI_API_KEY=sk-xxxxx
OPENAI_MODEL=gpt-4o-mini  # 任意、デフォルトはgpt-4o-mini
X_USER_ACCESS_TOKEN=xxxxx
X_DRY_RUN=true  # trueで投稿せずログのみ
```

### 3. ビルド

```bash
npm run build
```

### 4. 実行

```bash
# ビルド後に実行
npm run post

# 開発時（tsx使用、ビルド不要）
npm run dev
```

## GitHub Actions設定

### Secrets設定

リポジトリの Settings → Secrets and variables → Actions で以下を設定：

| Secret名 | 説明 | 必須 |
|---------|------|------|
| `OPENAI_API_KEY` | OpenAI APIキー | ○ |
| `OPENAI_MODEL` | 使用モデル（デフォルト: gpt-4o-mini） | - |
| `X_USER_ACCESS_TOKEN` | X OAuth2ユーザーアクセストークン | ○ |

### X APIトークンの取得

1. [X Developer Portal](https://developer.twitter.com/en/portal/dashboard) でアプリを作成
2. User authentication settings で OAuth 2.0 を有効化
3. App permissions を **Read and write** に設定
4. アクセストークンを生成（Bearer Token形式）

### 手動実行

Actions タブから「Post Tweet」ワークフローを手動実行可能。
`dry_run: true` を選択すると実際には投稿せずログのみ出力。

## ディレクトリ構造

```
.
├── src/
│   ├── agent/
│   │   └── run.ts           # エントリポイント
│   ├── clients/
│   │   ├── openai.ts        # OpenAI API (Structured Outputs)
│   │   └── x.ts             # X API (投稿・画像アップロード)
│   ├── core/
│   │   ├── prompt.ts        # プロンプト生成
│   │   ├── validate.ts      # バリデーション
│   │   ├── state.ts         # 状態管理
│   │   └── fallback.ts      # フォールバック
│   └── utils/
│       └── jst.ts           # JST時刻処理
├── config/
│   ├── persona.yaml         # キャラクター定義
│   ├── slots.yaml           # スロット定義
│   ├── themes.json          # テーマ候補
│   ├── logistics_words.txt  # 軽貨物語彙
│   ├── forbidden.txt        # 禁止語
│   └── fallback_tweets.txt  # フォールバック用定型文
├── assets/images/           # 投稿用画像
│   ├── delivery/            # 配達中スロット用
│   ├── commute/             # 移動・帰宅スロット用
│   ├── night/               # 夜スロット用
│   └── daily/               # その他・goodnight用
├── state/
│   └── state.json           # エージェント状態（自動更新）
└── .github/workflows/
    └── post.yml             # GitHub Actions
```

## 投稿スロット

| スロット | 時間帯(JST) | トーン |
|---------|------------|-------|
| delivery | 9-11, 14-17時 | 仕事中愚痴＋軽い恋愛妄想 |
| commute | 7-8, 18-20時 | 帰宅/移動の寂しさ |
| night_ero | 21-22時 | 夜の寂しさ＋軽い誘い（露骨禁止） |
| goodnight | 23-0時 | 甘えたおやすみ（1日1回） |

## 画像の追加方法

1. `assets/images/` 以下の適切なフォルダに画像を配置
2. 対応形式: jpg, jpeg, png, gif, webp
3. 推奨サイズ: 1200x675px以上（Twitter推奨）

例：
```bash
# 配達中の画像を追加
cp my_delivery_photo.jpg assets/images/delivery/

# 夜の雰囲気の画像を追加
cp night_city.jpg assets/images/night/
```

## バリデーション

投稿前に以下をチェック：

- ✅ 140字以内
- ✅ 絵文字2個以内
- ✅ 軽貨物関連ワード1つ以上含む
- ✅ 禁止語を含まない
- ✅ 直近投稿との類似度0.6以下

失敗時は最大2回再生成、それでも失敗ならフォールバック。

## コスト最適化

- **モデル**: gpt-4o-mini（最も低コスト）
- **Structured Outputs**: JSON整形失敗リトライを削減
- **max_tokens**: 150（短い出力）
- **プロンプト**: 簡潔に設計（入力トークン節約）
- **フォールバック**: OpenAI障害時はAPI呼び出しなし

## 状態管理

`state/state.json` で以下を追跡：

- 気分・エネルギー
- 直近7投稿
- 今日の投稿数・使用スロット
- 月間投稿数・画像投稿数
- NGリトライ回数・フォールバック使用回数

GitHub Actionsは投稿後に自動コミット・プッシュ。

## ローカル動作確認

```bash
# OpenAI APIのみでテスト（X投稿なし）
X_DRY_RUN=true npm run dev

# フォールバックのテスト（OpenAI APIキーなし）
unset OPENAI_API_KEY
X_DRY_RUN=true npm run dev
```

## 注意事項

- X APIの利用規約を遵守してください
- 過度な自動投稿はアカウント制限の対象になる可能性があります
- 禁止語リスト (`config/forbidden.txt`) を適宜更新してください
- 画像は著作権に注意して使用してください

## ライセンス

MIT
