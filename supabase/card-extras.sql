-- カードの追加機能（2026-10）: 裏面だけに表示する書き込み・関連カード・一覧用の低画質版の画像・地名
-- Supabase の SQL Editor で一度だけ実行してください（何度実行しても大丈夫です）
alter table public.cards add column if not exists back_path text;                    -- 裏面だけに表示する書き込みのレイヤー（ストレージ内の画像パス）
alter table public.cards add column if not exists thumb_path text;                  -- 一覧・地図用の低画質版（ストレージ内の画像パス）
alter table public.cards add column if not exists related   uuid[] not null default '{}'; -- 関連カードの id
-- PostgREST に新しい列を知らせる
alter table public.cards add column if not exists places jsonb not null default '[]'::jsonb;  -- 地名（都市・町。名前・英語・現地語・国・座標）
notify pgrst, 'reload schema';
