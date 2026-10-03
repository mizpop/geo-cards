// Supabase の接続設定
// SUPABASE_URL を空のままにすると「デモモード」で起動します（データはこのブラウザ内だけに保存）。
export const CONFIG = {
  // 例: 'https://abcdefghijklmnop.supabase.co'
  SUPABASE_URL: '',
  // Project Settings → API Keys の「anon / publishable」キー（公開して問題ないキー）
  SUPABASE_KEY: '',
  // 閲覧用アカウントのメールアドレス（Supabase で作成したもの）
  VIEWER_EMAIL: 'viewer@example.com',
  // 画像を保存するストレージバケット名（setup.sql と合わせる）
  BUCKET: 'card-images',
};
