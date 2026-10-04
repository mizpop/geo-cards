# GeoGuessr 単語帳

画像と説明から「どの国・地域で見られるか」を覚えるための、Quizlet 風の暗記カードアプリです。

- **暗記カード**: クリック / スペースキーでめくり、← → で移動。地域で絞り込みとシャッフルができます
- **クイズ**: 出題する地域・問題数・回答方式（4択 / 国名を入力）を選べます。間違えた問題だけ再挑戦もできます
- **検索**: 国名・地域名（日本語・英語）で、該当するカードをタイル状に一覧表示。クリックで拡大します
- **編集**（編集者のみ）: カードの追加・編集・削除。画像はファイル選択、ドラッグ＆ドロップ、クリップボードからの貼り付け（ボタンまたは Ctrl+V）に対応しています。国は地域ごとのリストから選びます（複数可）
- **バックアップ**: 画像込みの JSON を書き出し・読み込みできます
- **カテゴリー**: ボラード・シェブロンなどのカテゴリーで色分けします。編集タブの「🏷 カテゴリー管理」から、追加・名前変更・色変更・並べ替えができます。暗記カード・クイズ・検索・地図で絞り込めます
- **地図**: カードがある国を色で塗り分けて表示します。国をクリックするか拡大すると、その場所にカードのサムネイルが現れ、右側に一覧が出ます（地図: Leaflet / © OpenStreetMap contributors、国境データ: Natural Earth（world-atlas））
- **国の基本情報**: 地図の右側パネルで国名をクリックすると表示されます。国旗、言語（クリックで見分け方を表示）、国別ドメイン、通行方向、国際電話番号、首都、通貨、隣接国。国データは [mledoze/countries](https://github.com/mledoze/countries)（ODbL）から生成しています
- **国のメモ**: 国の詳細画面で、国ごとにメモを書けます（編集者のみ。入力が止まると自動保存）。地図の右パネルとプレビューの吹き出しにも表示されます。Supabase を使っている場合は `supabase/setup.sql` をもう一度 Run するとメモ用のテーブルが追加されます
- **メモ（チャット形式）**: 画面右下のボタンで開閉。どの画面からでも書けて、日付・時刻付きで履歴が残ります（Enter で送信、Shift+Enter で改行）。ログイン中の人は誰でも書け、消せるのは書いた本人と編集者です。Supabase では `supabase/setup.sql` を再実行するとテーブルが追加されます

構成: 静的な HTML/JS（ビルド不要）＋ Supabase（DB・画像ストレージ・ログイン）。クレジットカードは不要です。

---

## 0. まずローカルで試す（デモモード）

`js/config.js` が未設定の間は、データをブラウザ内だけに保存する「デモモード」で動きます。

```bash
cd geo-cards
python3 serve.py
# ブラウザで http://localhost:8000 を開く
```

※ `index.html` をダブルクリックして直接開くと動きません（ES モジュールの制約のため）。必ずサーバー経由で開いてください。
※ `serve.py` はブラウザにキャッシュさせないサーバーです。`python3 -m http.server` だと、更新後に古いファイルが混ざって起動しないことがあります（その場合は Ctrl+Shift+R）。

---

## 1. Supabase の準備（10 分ほど）

1. https://supabase.com で GitHub アカウントなどでサインアップし、**New project** を作成します
   - Region は `Northeast Asia (Tokyo)` がおすすめです
   - Database Password は自動生成で構いません（このアプリでは使いません）
2. 左メニューの **SQL Editor** を開き、`supabase/setup.sql` の中身を全文貼り付けて **Run** します（アプリを更新したときも、もう一度 Run すれば新しい項目が追加されます。既存のデータは消えません）
3. **新規登録を禁止する**（重要）
   - **Authentication → Sign In / Providers**（または Settings）で **Allow new users to sign up** を **OFF** にします
   - これを OFF にしないと、誰でもアカウントを作ってカードを閲覧できてしまいます
4. **アカウントを 2 つ作成する**: **Authentication → Users → Add user → Create new user**
   - **閲覧用**: メールアドレスは何でも構いません（例: `viewer@example.com`）。パスワードがそのまま「閲覧パスワード」になります。**Auto Confirm User** にチェックを入れてください
   - **編集者（あなた）**: 自分のメールアドレスと強めのパスワードで作成し、同じく **Auto Confirm User** にチェックを入れます
5. `supabase/add-editor.sql` のメールアドレスを自分のものに書き換えて、SQL Editor で **Run** します
6. **Project Settings → API Keys**（または Data API）で以下の 2 つを確認します
   - Project URL（`https://xxxx.supabase.co`）
   - `anon` キー、または `publishable` キー（ブラウザに置いてよい公開用のキー。**`service_role` / `secret` キーは絶対に使わないでください**）
7. `js/config.js` に記入します

```js
export const CONFIG = {
  SUPABASE_URL: 'https://xxxx.supabase.co',
  SUPABASE_KEY: 'eyJ...（または sb_publishable_...）',
  VIEWER_EMAIL: 'viewer@example.com',   // 手順 4 で作った閲覧用アカウント
  BUCKET: 'card-images',
};
```

ローカルで開き直すと、ログイン画面が表示されます。
- 閲覧パスワードを入力すると、閲覧のみ（暗記カード・クイズ・検索）を使えます
- 「編集者としてログイン」からメールアドレスとパスワードを入力すると、「編集」タブも表示されます

### セキュリティについて
- 権限は Supabase の RLS で、データベース側で制御しています。閲覧用アカウントでは、API を直接叩いても編集できません
- 画像は非公開のバケットに保存し、ログイン中のユーザーにだけ有効期限付きの URL を発行します
- 閲覧パスワードを変えたいときは、Authentication → Users で閲覧用ユーザーのパスワードを変更します

---

## 2. 公開する

### Cloudflare Pages（おすすめ・帯域無制限）
1. このフォルダを GitHub リポジトリに push します（Private で構いません）
2. Cloudflare ダッシュボード → **Workers & Pages → Create → Pages → Connect to Git** でリポジトリを選びます
3. Build command は **空欄**、Build output directory は `/` のままで **Deploy** します
- Git を使わない場合は、**Upload assets** でフォルダをドラッグ＆ドロップしても公開できます

### GitHub Pages
1. リポジトリを **Public** で作成して push します（無料プランでは Public のみ対象）
2. **Settings → Pages → Branch: main / (root)** を選んで保存します

どちらの方法でも、`js/config.js` のキーが公開されます。これは想定どおりで、`anon` / `publishable` キーは公開前提のキーです。データは RLS とログインで保護されています。

---

## 3. 一時停止を防ぐ（Supabase 無料プランの仕様）

無料プランのプロジェクトは、7 日間アクセスがないと一時停止します（データは消えず、ダッシュボードから再開できます）。

GitHub にリポジトリを置いた場合は、`.github/workflows/keepalive.yml` が週 2 回自動でアクセスします。
- リポジトリの **Settings → Secrets and variables → Actions → New repository secret** で、`SUPABASE_URL` と `SUPABASE_KEY` を登録してください
- **Actions** タブで **Supabase keepalive → Run workflow** を実行すると、動作を確認できます

---

## ファイル構成

```
index.html              画面の骨組み
css/style.css           スタイル（ライト / ダーク対応）
js/config.js            Supabase の接続設定
js/app.js               画面（暗記カード・クイズ・検索・編集）
js/api.js               データアクセス（Supabase / デモ）
js/countries.js         地域ごとの国リスト（追加・並べ替えはここで）
js/geo.js               地図上の国の位置
js/countryinfo.js       国の基本データ（自動生成）
js/aliases.js           国の別名・略称（USA, UK, JP など。自動生成＋日本語の別名）
js/languages.js         言語の見分け方・左側通行の国
js/map.js               世界地図
js/zoom.js              画像の拡大・移動
js/chat.js              チャット形式のメモ
js/sound.js             効果音（Web Audio で合成）
js/image.js             画像の圧縮・クリップボード
supabase/setup.sql      テーブル・RLS・ストレージの初期設定
supabase/add-editor.sql 編集者の登録
supabase/realtime-cards.sql カードの変更をリアルタイムで反映する設定（既存の環境に追加）
```

画像はアップロード時に、長辺 1600px の WebP に圧縮されます（1 枚あたり約 100〜250KB）。無料枠のストレージ 1GB で、数千枚を保存できます。
