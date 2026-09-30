# 補填管理アプリ agent.md

## 1. プロジェクト概要
- 目的: FiveMギャングの犯罪時費用（罰金・個人医代・その他）をプール金から全額補填するための管理サイト
- 利用規模: 10人以上、大規模ギャング想定
- 公開方法: GitHub Pages（静的ホスティング）+ Supabase（DB/Auth/Realtime）
- 運用言語: 日本語、スマホファースト

## 2. 業務フロー（確定仕様）
1. 犯罪枠作成: 誰かが `日時 / 犯罪種別 / 場所 / メモ` で枠を立てる。status=`受付中`
2. 参加表明: 参加者が枠に自分の名前を追加。後乗り追加可。
   - 未決定A: 自己申告のみか、幹部による代理追加可か → 暫定: 両方可
3. 被害申告: 各自が自分の分だけ申告する。
   - 入力: 罰金額、個人医利用有無+金額、その他費用、備考
   - 合計自動計算、status=`申請中`
   - 罰金0の参加者は申告なしでOK（`未申告`のまま）
4. 補填対応: ボス / アンダーボスがプール金から現金で渡した後、該当者の申請を `補填済み` にする。
   - 未決定B: 人単位マーク + 枠ごと一括完了ボタンの両方を実装する
   - 全員補填済み（または申告なし）で枠を `完了` にクローズ
5. 台帳連動: 補填済み化と同時に `pool_transactions` に出金レコードを自動作成（handled_by=対応したボス名）

## 3. 機能要件
### MVP
- [ ] ダッシュボード: プール残高、今月支出、未補填件数・金額、受付中の枠一覧
- [ ] 犯罪枠CRUD: 作成、編集、クローズ、削除（権限制御あり）
- [ ] 参加管理: 参加追加/離脱、代理追加
- [ ] 申告フォーム: 自分のclaimのみ作成・編集、合計自動計算
- [ ] ボス承認UI: 個別トグル + 一括補填ボタン、残高不足警告
- [ ] プール台帳: 入金（上納金・分配金）手動登録、出金自動+手動、残高表示
- [ ] 集計: メンバー別、犯罪種別別、月別、フィルタ・検索
- [ ] CSV/JSONエクスポート
### Phase2
- [ ] Discord Webhook通知（枠作成・申告・補填完了）
- [ ] 証拠スクショ保存（Supabase Storage）
- [ ] 月次締めレポート

## 4. 技術構成
- Frontend: ビルド不要。`index.html` + `styles.css` + `app.js` + `supabaseClient.js`、Supabase JS v2 CDN
  - デザイン: Tech Editorialテンプレート採用（運用ダッシュボード向け）
- Backend: Supabase Postgres + Auth + RLS + Realtime
- Hosting: GitHub Pages（`main`ブランチ `/docs` または `gh-pages`）
- ルーティング: ハッシュSPA `#/dashboard` `#/jobs` `#/jobs/:id` `#/pool` `#/members`

## 5. ディレクトリ構成（予定）
```
補填管理アプリ/
  agent.md（本書）
  docs/ または root/
    index.html
    app.js
    supabaseClient.js
    schema.sql
  README.md
```

## 6. DB設計
### 6.1 テーブル
- members: id(uuid), name(text unique), role(text: boss/underboss/member), is_active(bool default true), created_at
- crime_types: id(serial), category(text: 準大型/大型), name(text unique), capacity(int), default_fine(int default 0), default_medic(int default 0)
  - 初期マスタ（確定）:
    - 準大型 / 客船 / 12人
    - 準大型 / ボブキャット / 12人
    - 準大型 / 美術館 / 12人
    - 大型 / 飛行場 / 12人
    - 大型 / アーティファクト / 15人
    - 大型 / ユニオン / 15人
    - 大型 / カジノ / 15人
- crime_jobs: id(uuid), crime_type_id(int FK), occurred_at(timestamptz), location(text), memo(text), status(text: 受付中/精算中/完了), created_by(uuid FK members), created_at
- job_participants: job_id(uuid FK), member_id(uuid FK), joined_at, PRIMARY KEY(job_id, member_id)
- expense_claims: id(uuid), job_id(uuid FK), member_id(uuid FK), fine_amount(int default 0), medic_used(bool default false), medic_cost(int default 0), other_cost(int default 0), total(int generated: fine+medic+other), status(text: 未申告/申請中/補填済), note(text), updated_at, UNIQUE(job_id, member_id)
- pool_transactions: id(uuid), type(text: 入金/出金), amount(int check >0), claim_id(uuid FK nullable), job_id(uuid FK nullable), handled_by(uuid FK members), memo(text), created_at

### 6.2 schema.sql叩き台（`schema.sql` に実体あり）
```sql
create table crime_types(id serial primary key, category text not null check (category in ('準大型','大型')), name text unique not null, capacity int not null, default_fine int default 0, default_medic int default 0);
insert into crime_types(category, name, capacity) values
 ('準大型','客船',12),('準大型','ボブキャット',12),('準大型','美術館',12),
 ('大型','飛行場',12),('大型','アーティファクト',15),('大型','ユニオン',15),('大型','カジノ',15);
```

### 6.3 RLS方針（確定：ハイブリッド認証）
- 一般操作（枠作成・参加・申告）は認証なし（anon可）
- 補填完了マーク・pool出金・ダッシュボード・メンバー管理はボス/アンダーボスのみログイン必須
- 実装：Supabase Auth（ボス用2アカウント）+ members.role連携。anonにはINSERT/SELECTのみ許可、UPDATEのstatus→`補填済み`はauthenticated+bossのみ
- anon key露出前提のため、service_roleは使わない。削除はbossのみ

## 7. 画面詳細
- 一覧: ステータスフィルタ、未補填バッジ、プール残高ヘッダー常時表示
- 詳細 (`jobs/:id`): 上部=枠情報、中部=参加者リスト（各人の申告状態色分け）、下部=自分の申告フォーム、ボス専用=補填操作パネル
- プール: 残高カード、入出金フォーム、履歴テーブル
- メンバー: 追加・無効化・役職変更（bossのみ）

## 8. バリデーション
- 金額は0以上整数、空=0扱い
- medic_used=falseならmedic_costは0に強制
- 同一job+memberのclaimは1件（upsert）
- 出金時に残高不足なら警告表示（ブロックはしない＝現場優先）

## 9. GitHub Pagesデプロイ手順
1. GitHubで `gang-pool` 等のリポジトリ作成（public）
2. このフォルダの `index.html` 群を `/docs` に配置
3. Settings > Pages > Deploy from branch: `main` / `/docs`
4. SupabaseのURL・anon keyを `supabaseClient.js` に設定
5. 動作確認後、メンバーにURL共有（publicのためサーバー名・本名は載せない）

## 10. 開発タスクリスト
- [x] crime_types初期データ確定（7件確定、上記マスタ）
- [x] schema.sql作成（適用待ち）
- [x] docs試作版作成（index.html/app.js/supabaseClient.js、ローカル動作可、ボス混在認証）
- [x] Supabaseキー埋め込み + RLS適用（キー埋め込み済み、SQL適用は手動要）
- [x] supabaseClient.js + Auth本番化（合言葉「豆人あずき」設定済み、Supabase Auth本格化はTODO）
- [ ] git commit済み（ローカル）→ push + Pages有効化（認証待ち）
- [ ] supabaseClient.js + Auth（合言葉方式か個別アカウントか決定）
- [ ] index.html骨格 + 4タブSPA
- [ ] 枠作成・参加・申告・補填のCRUD接続
- [ ] プール残高計算・警告・集計クエリ
- [ ] エクスポート機能
- [ ] 試験運用（10人1週間）→ 修正

## 11. 未決定・要ヒアリング
- A. 参加者追加は幹部代行可か
- B. 一括補填ボタンの要否（暫定あり）
- C. Supabase Auth方式（個別メールか合言葉共有か）
- D. 犯罪種別マスタの初期リスト
- E. GitHubアカウント・リポジトリ名・Pages公開範囲の承認

## 12. セキュリティ・運用注意
- GitHub Pagesはpublic前提。キャラ名はハンドルネームのみ推奨
- 金額改ざん防止のため、補填済み後のclaim編集はbossのみ
- プール残高マイナス許容は現場判断、月次で棚卸しすること
