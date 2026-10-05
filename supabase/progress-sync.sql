-- 学習記録の端末間同期（引き継ぎコード）: PC とスマホなどで「覚えた / まだ」の記録・毎日の回数・自己ベストを共有します
-- Supabase の SQL Editor で一度だけ実行してください（何度実行しても大丈夫です）
--
-- 仕組み: 端末ごとに作った「引き継ぎコード」を知っている人だけが、そのコードの記録を読み書きできます。
-- テーブルには直接アクセスさせず（ポリシーなし）、コードを指定する関数だけを通します（コードの一覧は取れません）。
create table if not exists public.progress_sync (
  code       text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.progress_sync enable row level security;

create or replace function public.sync_get(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('data', data, 'updated_at', updated_at) from public.progress_sync where code = p_code
$$;

create or replace function public.sync_put(p_code text, p_data jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_code is null or length(p_code) < 16 then raise exception 'code too short'; end if;
  if pg_column_size(p_data) > 3000000 then raise exception 'data too large'; end if;
  insert into public.progress_sync (code, data, updated_at) values (p_code, p_data, now())
  on conflict (code) do update set data = excluded.data, updated_at = now();
  return now();
end
$$;

revoke all on function public.sync_get(text) from public, anon;
revoke all on function public.sync_put(text, jsonb) from public, anon;
grant execute on function public.sync_get(text) to authenticated;
grant execute on function public.sync_put(text, jsonb) to authenticated;
notify pgrst, 'reload schema';
