// Supabase の接続設定
// SUPABASE_URL を空のままにすると「デモモード」で起動します（データはこのブラウザ内だけに保存）。
export const CONFIG = {
  // 例: 'https://abcdefghijklmnop.supabase.co'
  SUPABASE_URL: 'https://kddnjwksbtjqvrlnqbcf.supabase.co',
  // Project Settings → API Keys の「anon / publishable」キー（公開して問題ないキー）
  SUPABASE_KEY: 'sb_publishable_h4NiJiKIqPpvnU9CbTWFCQ_1sRZzy3X',
  // 閲覧用アカウントのメールアドレス（Supabase で作成したもの）
  VIEWER_EMAIL: 'mzkmorohashi@gmail.com',
  // 編集者のメールアドレス（ログイン画面では、パスワードだけを入力する）
  EDITOR_EMAIL: 'djaa7hnmso@sute.jp',
  // 画像を保存するストレージバケット名（setup.sql と合わせる）
  BUCKET: 'card-images',
};
