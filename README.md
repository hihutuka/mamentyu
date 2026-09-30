# ギャング補填管理
FiveMギャング用プール金補填管理サイト（GitHub Pages + Supabase）

## 公開手順
1. このリポジトリを push 後、GitHub > Settings > Pages > Deploy from branch: `main` / `/docs`
2. Supabase SQL Editorで `schema.sql` を実行（テーブル+初期犯罪7件+RLS）
3. `docs/supabaseClient.js` にURL・キー設定済み
4. URL共有。ボス-login合言葉で補填操作

## 構成
- docs/index.html: SPA本体
- docs/app.js: ロジック（localStorage優先、Supabase拡張予定）
- docs/supabaseClient.js: 接続設定
- schema.sql: DB定義
- agent.md: 詳細プラン
