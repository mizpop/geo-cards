-- 不具合の記録（アプリが送る）。ログインしている人が送れて、編集者だけが読める
-- Supabase の SQL Editor で、1 回だけ実行する（実行しなくても、アプリは動く。その場合、記録はこのブラウザにだけ残る）
create table if not exists public.error_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid(),
  created_at timestamptz not null default now(),
  message text not null,
  stack text,
  view text,
  version text,
  ua text,
  kind text,
  crumbs jsonb
);
alter table public.error_reports enable row level security;
drop policy if exists "error_reports insert" on public.error_reports;
create policy "error_reports insert" on public.error_reports for insert to authenticated with check (true);
drop policy if exists "error_reports editors read" on public.error_reports;
create policy "error_reports editors read" on public.error_reports for select to authenticated using (public.is_editor());
drop policy if exists "error_reports editors delete" on public.error_reports;
create policy "error_reports editors delete" on public.error_reports for delete to authenticated using (public.is_editor());
