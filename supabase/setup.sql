-- GeoGuessr 単語帳: Supabase 初期設定
-- Supabase ダッシュボード → SQL Editor に全文を貼り付けて「Run」してください。
-- 何度実行しても壊れないように書いてあります。

-- ========== テーブル ==========
create table if not exists public.cards (
  id          uuid primary key default gen_random_uuid(),
  image_path  text not null,                       -- ストレージ内の画像パス
  description text not null default '',            -- 表面の説明
  countries   text[] not null default '{}',        -- 裏面の国・地域コード（ISO 3166-1 alpha-2）
  area        text not null default '',            -- 詳細エリア（任意）
  notes       text not null default '',            -- 解説
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists cards_countries_idx on public.cards using gin (countries);

-- 編集できるユーザーの一覧
create table if not exists public.editors (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- ログイン中のユーザーが編集者かどうか
create or replace function public.is_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.editors where user_id = auth.uid());
$$;

-- カテゴリー（シェブロン・ボラードなど）
create table if not exists public.categories (
  id    uuid primary key default gen_random_uuid(),
  name  text not null,
  color text not null default '#868e96',
  sort  integer not null default 0
);
alter table public.cards add column if not exists category_id uuid references public.categories (id) on delete set null;

-- 初期カテゴリー（まだ1つもない場合のみ）
insert into public.categories (name, color, sort)
select v.name, v.color, v.sort
from (values
  ('ボラード', '#e03131', 10), ('シェブロン', '#f59f00', 20), ('道路標識', '#1c7ed6', 30),
  ('道路標示・ライン', '#74b816', 40), ('ナンバープレート', '#7048e8', 50), ('電柱', '#795548', 60),
  ('言語・文字', '#d6336c', 70), ('建物・街並み', '#1098ad', 80), ('自然・植生', '#2f9e44', 90),
  ('Googleカー・カメラ', '#868e96', 100), ('国旗', '#ae3ec9', 105), ('その他', '#4263eb', 110)
) as v(name, color, sort)
where not exists (select 1 from public.categories);

-- 国ごとのメモ（国コード = ISO 3166-1 alpha-2）
create table if not exists public.country_notes (
  code       text primary key,
  note       text not null default '',
  updated_at timestamptz not null default now()
);

-- チャット形式のメモ（画面右下のボタン）
create table if not exists public.memos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author     text not null default '',
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists memos_created_at_idx on public.memos (created_at desc);

-- ========== 行レベルセキュリティ（RLS） ==========
-- 閲覧: ログインしているユーザー（閲覧用アカウント・編集者）のみ
-- 追加・更新・削除: 編集者のみ
alter table public.cards   enable row level security;
alter table public.editors enable row level security;

drop policy if exists "cards: read"   on public.cards;
drop policy if exists "cards: insert" on public.cards;
drop policy if exists "cards: update" on public.cards;
drop policy if exists "cards: delete" on public.cards;
create policy "cards: read"   on public.cards for select to authenticated using (true);
create policy "cards: insert" on public.cards for insert to authenticated with check (public.is_editor());
create policy "cards: update" on public.cards for update to authenticated using (public.is_editor()) with check (public.is_editor());
create policy "cards: delete" on public.cards for delete to authenticated using (public.is_editor());

alter table public.categories enable row level security;
drop policy if exists "categories: read"  on public.categories;
drop policy if exists "categories: write" on public.categories;
create policy "categories: read"  on public.categories for select to authenticated using (true);
create policy "categories: write" on public.categories for all to authenticated using (public.is_editor()) with check (public.is_editor());

alter table public.country_notes enable row level security;
drop policy if exists "country_notes: read"  on public.country_notes;
drop policy if exists "country_notes: write" on public.country_notes;
create policy "country_notes: read"  on public.country_notes for select to authenticated using (true);
create policy "country_notes: write" on public.country_notes for all to authenticated using (public.is_editor()) with check (public.is_editor());

-- メモ: ログイン中なら読める・書ける。消せるのは書いた本人と編集者
alter table public.memos enable row level security;
drop policy if exists "memos: read"   on public.memos;
drop policy if exists "memos: insert" on public.memos;
drop policy if exists "memos: delete" on public.memos;
create policy "memos: read"   on public.memos for select to authenticated using (true);
create policy "memos: insert" on public.memos for insert to authenticated with check (user_id = auth.uid());
create policy "memos: delete" on public.memos for delete to authenticated using (user_id = auth.uid() or public.is_editor());

drop policy if exists "editors: read own" on public.editors;
create policy "editors: read own" on public.editors for select to authenticated using (user_id = auth.uid());

revoke all on public.cards, public.editors, public.categories, public.country_notes, public.memos from anon;
grant select, insert, update, delete on public.cards to authenticated;
grant select on public.editors to authenticated;
grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.country_notes to authenticated;
grant select, insert, delete on public.memos to authenticated;
grant execute on function public.is_editor() to authenticated;

-- ========== 画像ストレージ（非公開バケット） ==========
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-images', 'card-images', false, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "card-images: read"   on storage.objects;
drop policy if exists "card-images: insert" on storage.objects;
drop policy if exists "card-images: update" on storage.objects;
drop policy if exists "card-images: delete" on storage.objects;
create policy "card-images: read"   on storage.objects for select to authenticated using (bucket_id = 'card-images');
create policy "card-images: insert" on storage.objects for insert to authenticated with check (bucket_id = 'card-images' and public.is_editor());
create policy "card-images: update" on storage.objects for update to authenticated using (bucket_id = 'card-images' and public.is_editor());
create policy "card-images: delete" on storage.objects for delete to authenticated using (bucket_id = 'card-images' and public.is_editor());

-- ========== リアルタイム配信（ほかの端末での変更を即座に表示: メモ・カード・カテゴリー・国のメモ） ==========
do $$
declare t text;
begin
  foreach t in array array['memos', 'cards', 'categories', 'country_notes'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
