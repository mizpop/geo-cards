-- カードの追加機能（2026-10）: 裏面だけに表示する書き込み・関連カード・一覧用の低画質版の画像・地名・保存したストリートビュー
-- Supabase の SQL Editor で一度だけ実行してください（何度実行しても大丈夫です）
alter table public.cards add column if not exists back_path text;                    -- 裏面だけに表示する書き込みのレイヤー（ストレージ内の画像パス）
alter table public.cards add column if not exists thumb_path text;                  -- 一覧・地図用の低画質版（ストレージ内の画像パス）
alter table public.cards add column if not exists related   uuid[] not null default '{}'; -- 関連カードの id
-- PostgREST に新しい列を知らせる
alter table public.cards add column if not exists places jsonb not null default '[]'::jsonb;  -- 地名（都市・町。名前・英語・現地語・国・座標）
-- 保存したストリートビュー（ストリートビューのウィンドウの保存ボタン → ストリートビュータブ）
create table if not exists public.saved_streetviews (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid default auth.uid() references auth.users (id) on delete set null,
  lat        double precision not null,
  lng        double precision not null,
  code       text not null default '',   -- 国コード（自動）
  name       text not null default '',   -- 大まかな地名（日本語）
  name_en    text not null default '',
  name_local text not null default '',   -- 現地の言語
  admin      text not null default '',   -- 州・県など
  note       text not null default '',
  heading    double precision not null default 0,   -- 向き（度）
  pitch      double precision not null default 0,   -- 傾き（度。上が正）
  fov        double precision not null default 0,   -- 視野（度。小さいほど拡大。0 は標準）
  created_at timestamptz not null default now()
);
-- 以前に表を作った場合のために、列を足す
alter table public.saved_streetviews add column if not exists heading double precision not null default 0;
alter table public.saved_streetviews add column if not exists pitch   double precision not null default 0;
alter table public.saved_streetviews add column if not exists fov     double precision not null default 0;
create index if not exists saved_streetviews_created_idx on public.saved_streetviews (created_at desc);
alter table public.saved_streetviews enable row level security;
drop policy if exists "saved_streetviews: read"  on public.saved_streetviews;
drop policy if exists "saved_streetviews: write" on public.saved_streetviews;
create policy "saved_streetviews: read"  on public.saved_streetviews for select to authenticated using (true);
create policy "saved_streetviews: write" on public.saved_streetviews for all to authenticated using (public.is_editor()) with check (public.is_editor());
revoke all on public.saved_streetviews from anon;
grant select, insert, update, delete on public.saved_streetviews to authenticated;
notify pgrst, 'reload schema';
