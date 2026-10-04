-- 地図のインフォグラフィック（シェブロン・ガードレール）の値を保存するテーブル
-- setup.sql を以前に実行済みの場合は、これを SQL Editor に貼り付けて Run してください（何度実行しても問題ありません）
-- 国ごとの情報（地図のインフォグラフィック: シェブロンの色・ガードレールの種類など）
create table if not exists public.country_facts (
  code       text not null,
  topic      text not null,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (code, topic)
);
alter table public.country_facts enable row level security;
drop policy if exists "country_facts: read"  on public.country_facts;
drop policy if exists "country_facts: write" on public.country_facts;
create policy "country_facts: read"  on public.country_facts for select to authenticated using (true);
create policy "country_facts: write" on public.country_facts for all to authenticated using (public.is_editor()) with check (public.is_editor());
revoke all on public.country_facts from anon;
grant select, insert, update, delete on public.country_facts to authenticated;

-- ほかの端末での変更を即座に表示（リアルタイム配信）
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'country_facts'
  ) then
    alter publication supabase_realtime add table public.country_facts;
  end if;
end $$;
