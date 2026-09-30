-- 補填管理アプリ setup.sql
-- これ1つをSupabase SQL Editorに貼って実行すればOK（何度実行しても安全）
-- 'TEMP-PASS' は初期パスワードに書き換えること

create extension if not exists pgcrypto;

create table if not exists members(
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  role text not null default 'member',
  is_active boolean default true,
  created_at timestamptz default now()
);
alter table members add column if not exists is_active boolean default true;

create table if not exists crime_types(
  id serial primary key,
  category text not null,
  name text unique not null,
  capacity int not null,
  default_fine int default 0,
  default_medic int default 0
);
insert into crime_types(category, name, capacity) values
 ('準大型','客船',12),
 ('準大型','ボブキャット',12),
 ('準大型','美術館',12),
 ('大型','飛行場',12),
 ('大型','アーティファクト',15),
 ('大型','ユニオン',15),
 ('大型','カジノ',15)
on conflict (name) do update set category=excluded.category, capacity=excluded.capacity;

create table if not exists crime_jobs(
  id uuid primary key default gen_random_uuid(),
  crime_type_id int references crime_types(id),
  occurred_at timestamptz default now(),
  location text,
  memo text,
  status text default '受付中',
  created_by uuid references members(id),
  created_at timestamptz default now()
);

create table if not exists job_participants(
  job_id uuid references crime_jobs(id) on delete cascade,
  member_id uuid references members(id) on delete cascade,
  joined_at timestamptz default now(),
  primary key(job_id, member_id)
);

create table if not exists expense_claims(
  id uuid primary key default gen_random_uuid(),
  job_id uuid references crime_jobs(id) on delete cascade,
  member_id uuid references members(id) on delete cascade,
  fine_amount int default 0 check (fine_amount>=0),
  medic_used boolean default false,
  medic_cost int default 0 check (medic_cost>=0),
  other_cost int default 0 check (other_cost>=0),
  status text default '申請中',
  note text,
  updated_at timestamptz default now(),
  unique(job_id, member_id)
);

create table if not exists pool_transactions(
  id uuid primary key default gen_random_uuid(),
  type text,
  amount int check (amount>0),
  claim_id uuid references expense_claims(id),
  job_id uuid references crime_jobs(id),
  handled_by uuid references members(id),
  memo text,
  created_at timestamptz default now()
);

-- 制約の正規化
ALTER TABLE expense_claims DROP CONSTRAINT IF EXISTS expense_claims_status_check;
ALTER TABLE expense_claims ADD CONSTRAINT expense_claims_status_check CHECK (status in ('未申告','申請中','補填済み'));
ALTER TABLE crime_jobs DROP CONSTRAINT IF EXISTS crime_jobs_status_check;
ALTER TABLE crime_jobs ADD CONSTRAINT crime_jobs_status_check CHECK (status in ('受付中','精算中','完了'));
ALTER TABLE pool_transactions DROP CONSTRAINT IF EXISTS pool_transactions_type_check;
ALTER TABLE pool_transactions ADD CONSTRAINT pool_transactions_type_check CHECK (type in ('入金','出金'));
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_role_check;
ALTER TABLE members ADD CONSTRAINT members_role_check CHECK (role in ('boss','underboss','member','mercenary'));
ALTER TABLE crime_types DROP CONSTRAINT IF EXISTS crime_types_category_check;
ALTER TABLE crime_types ADD CONSTRAINT crime_types_category_check CHECK (category in ('準大型','大型'));

-- RLS試運転用（anonでも操作可、補填・出金はアプリ側でボスゲート）
alter table members enable row level security;
alter table crime_types enable row level security;
alter table crime_jobs enable row level security;
alter table job_participants enable row level security;
alter table expense_claims enable row level security;
alter table pool_transactions enable row level security;
drop policy if exists open_all on members; create policy open_all on members for all to anon, authenticated using (true) with check (true);
drop policy if exists open_all on crime_types; create policy open_all on crime_types for all to anon, authenticated using (true) with check (true);
drop policy if exists open_all on crime_jobs; create policy open_all on crime_jobs for all to anon, authenticated using (true) with check (true);
drop policy if exists open_all on job_participants; create policy open_all on job_participants for all to anon, authenticated using (true) with check (true);
drop policy if exists open_all on expense_claims; create policy open_all on expense_claims for all to anon, authenticated using (true) with check (true);
drop policy if exists open_all on pool_transactions; create policy open_all on pool_transactions for all to anon, authenticated using (true) with check (true);

-- ログイン基盤
create table if not exists member_secrets(
  member_id uuid primary key references members(id) on delete cascade,
  password_hash text not null,
  updated_at timestamptz default now()
);

create or replace function verify_member(p_name text, p_password text)
returns table(id uuid, name text, role text)
language sql security definer set search_path = public as $$
  select m.id, m.name, m.role from members m
  join member_secrets s on s.member_id = m.id
  where m.name = p_name and m.is_active is distinct from false
    and s.password_hash = crypt(p_password, s.password_hash);
$$;

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

create or replace function signup_member(p_name text, p_password text)
returns table(id uuid, name text, role text)
language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if p_name is null or btrim(p_name) = '' then raise exception 'empty name'; end if;
  if char_length(p_password) < 4 then raise exception 'short password'; end if;
  perform 1 from members where members.name = btrim(p_name);
  if found then raise exception 'name taken'; end if;
  insert into members(name, role) values (btrim(p_name), 'mercenary') returning members.id into nid;
  insert into member_secrets(member_id, password_hash) values (nid, crypt(p_password, gen_salt('bf')));
  return query select m.id, m.name, m.role from members m where m.id = nid;
end $$;

-- 既存メンバーの初期パスワード（未設定の人のみ、変更済みは上書きしない）
insert into member_secrets(member_id, password_hash)
select id, crypt('TEMP-PASS', gen_salt('bf')) from members
on conflict (member_id) do nothing;
