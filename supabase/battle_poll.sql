-- 対戦の予備の通信（HTTP だけ）。WebSocket が通らない回線（会社・学校・一部の携帯回線など）でも、対戦できるようにする
-- Supabase の SQL Editor で、1 回だけ実行する（実行しなくても、ふつうの回線では、これまでどおり対戦できる）
create table if not exists public.battle_messages (
  id bigint generated always as identity primary key,
  room text not null,
  sender text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists battle_messages_room_id on public.battle_messages (room, id);
create index if not exists battle_messages_created on public.battle_messages (created_at);
create table if not exists public.battle_presence (
  room text not null,
  member text not null,
  info jsonb not null,
  seen timestamptz not null default now(),
  primary key (room, member)
);
alter table public.battle_messages enable row level security;
alter table public.battle_presence enable row level security;
-- ログインしている人が、読み書きできる（部屋のコードを知っている人どうしの、短い通信。古いものは、自動で消える）
drop policy if exists "battle_messages rw" on public.battle_messages;
create policy "battle_messages rw" on public.battle_messages for select to authenticated using (true);
drop policy if exists "battle_messages insert" on public.battle_messages;
create policy "battle_messages insert" on public.battle_messages for insert to authenticated with check (char_length(room) <= 12 and pg_column_size(payload) < 400000);
drop policy if exists "battle_messages cleanup" on public.battle_messages;
create policy "battle_messages cleanup" on public.battle_messages for delete to authenticated using (created_at < now() - interval '1 hour');
drop policy if exists "battle_presence rw" on public.battle_presence;
create policy "battle_presence rw" on public.battle_presence for all to authenticated using (true) with check (char_length(room) <= 12);
