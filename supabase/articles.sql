-- ガイド（ユーザーが書く記事）: 記事・フォルダ（2026-10）
-- Supabase の SQL Editor で一度だけ実行してください（何度実行しても大丈夫です）
create table if not exists public.article_folders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid default auth.uid() references auth.users (id) on delete set null,
  name       text not null default '',
  icon       text not null default '',          -- 絵文字、または小さな画像（data:image/…）
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.articles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid default auth.uid() references auth.users (id) on delete set null,
  title      text not null default '',
  body       text not null default '',          -- マークダウン。画像は ![](img:パス) / ![](card:カードのid)、リンクは [[card:id]] / [[sv:id]]
  folder_id  uuid references public.article_folders (id) on delete set null,
  related    uuid[] not null default '{}',      -- 関連記事の id
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.article_folders enable row level security;
alter table public.articles enable row level security;
drop policy if exists "article_folders: read"  on public.article_folders;
drop policy if exists "article_folders: write" on public.article_folders;
drop policy if exists "articles: read"  on public.articles;
drop policy if exists "articles: write" on public.articles;
create policy "article_folders: read"  on public.article_folders for select to authenticated using (true);
create policy "article_folders: write" on public.article_folders for all to authenticated using (public.is_editor()) with check (public.is_editor());
create policy "articles: read"  on public.articles for select to authenticated using (true);
create policy "articles: write" on public.articles for all to authenticated using (public.is_editor()) with check (public.is_editor());
revoke all on public.article_folders from anon;
revoke all on public.articles from anon;
grant select, insert, update, delete on public.article_folders to authenticated;
grant select, insert, update, delete on public.articles to authenticated;
notify pgrst, 'reload schema';
