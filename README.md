# KeibaSimu

Webブラウザで動く競馬予想ゲーム。フロントエンドは React + TailwindCSS + lucide-react、バックエンドは Node.js (Express) + PostgreSQL (pg) で構成しており、Railway で別サービスとしてデプロイすることを想定している。

## ディレクトリ構成

- `frontend/` … React (Vite) + TailwindCSS フロントエンド
  - `src/app/page.jsx` … メイン画面（3 フェーズの UI）
  - `src/utils/game-logic.js` … 馬生成・オッズ計算・レースシミュレーションなどのゲームロジック
- `backend/` … Express + pg バックエンド
  - `index.js` … API サーバ本体
  - `migrate.js` … マイグレーション処理（新フィールドはデフォルト値で補完）

## セットアップ

### フロントエンド

```bash
cd frontend
npm install
npm run dev      # 開発: http://localhost:5173
npm run build    # 本番ビルド
npm run preview  # Railway 用プレビュー（PORT に従う）
```

### バックエンド

`.env.example` をコピーして `.env` を作成し、`DATABASE_URL` を設定する。

```bash
cd backend
npm install
npm run migrate  # マイグレーション実行
npm start        # http://localhost:3001
```

## API エンドポイント（初期）

| メソッド | パス | 説明 |
|---|---|---|
| GET  | /api/horses | 馬一覧取得 |
| POST | /api/horses | 馬を保存 |
| GET  | /api/races  | レース履歴取得 |
| POST | /api/races  | レース結果を保存 |

## ゲーム仕様の主要ポイント

- 出走馬は 8 頭、ベース値 speed / stamina / stability は 50〜90 のランダム値。
- 調子は二重構造：`trueCondition`（非表示）と `displayCondition`（表示）。
- 7 種類の脚質（大逃げ / 逃げ / 先行 / 差し / 追込 / 直線一気 / まくり）が序盤/中盤/終盤で異なる倍率を持つ。
- レースは 145 ステップ × 120ms（約 17 秒）でシミュレートし、各馬の位置でフェーズ判定する。
- オッズは強さスコアから比率を出し、控除率 15%（最低 1.1 倍）を適用する。
