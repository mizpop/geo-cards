-- カードの変更をリアルタイムで反映するための設定（setup.sql を以前に実行済みの場合は、これだけ実行すれば OK）
-- Supabase の SQL Editor に貼り付けて Run してください。何度実行しても問題ありません。
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

-- 確認用: リアルタイム配信の対象になっているテーブル
select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public';
