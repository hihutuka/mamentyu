-- 補填管理アプリ auth.sql v0.1
-- Supabase SQL Editorに貼って実行（schema.sql適用後に実行すること）

create extension if not exists pgcrypto;

create table if not exists member_secrets(
  member_id uuid primary key references members(id) on delete cascade,
  password_hash text not null,
  updated_at timestamptz default now()
);

-- ログイン照合（ハッシュは返さない）
create or replace function verify_member(p_name text, p_password text)
returns table(id uuid, name text, role text)
language sql security definer set search_path = public as $$
  select m.id, m.name, m.role from members m
  join member_secrets s on s.member_id = m.id
  where m.name = p_name and m.is_active is distinct from false
    and s.password_hash = crypt(p_password, s.password_hash);
$$;

-- 本人によるパスワード変更（旧パス必須）
create or replace function change_own_password(p_member_id uuid, p_old_password text, p_new_password text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform 1 from member_secrets
  where member_id = p_member_id and password_hash = crypt(p_old_password, password_hash);
  if not found then raise exception 'old password mismatch'; end if;
  insert into member_secrets(member_id, password_hash)
  values (p_member_id, crypt(p_new_password, gen_salt('bf')))
  on conflict (member_id) do update set password_hash = excluded.password_hash, updated_at = now();
  return true;
end $$;

-- 全員の初期パスワードを一括設定（'TEMP-PASS' を好きな初期値に変えて実行）
insert into member_secrets(member_id, password_hash)
select id, crypt('TEMP-PASS', gen_salt('bf')) from members
on conflict (member_id) do update set password_hash = excluded.password_hash, updated_at = now();

-- 個別設定用テンプレ（名前とパスを変えて実行）
-- insert into member_secrets(member_id, password_hash)
-- values ((select id from members where name='名前'), crypt('パス', gen_salt('bf')))
-- on conflict (member_id) do update set password_hash = excluded.password_hash, updated_at = now();
