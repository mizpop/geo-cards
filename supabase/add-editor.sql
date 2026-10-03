-- 編集者を登録する（Authentication → Users で編集者アカウントを作成した後に実行）
-- 'you@example.com' を自分のメールアドレスに書き換えてから Run してください。
insert into public.editors (user_id)
select id from auth.users where email = 'kossorimzk@gmail.com'
on conflict do nothing;

-- 確認用: 登録されている編集者
select u.email from public.editors e join auth.users u on u.id = e.user_id;
