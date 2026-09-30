-- 補填管理アプリ schema.sql v0.1
-- Supabase SQL Editorにそのまま貼って実行可能

create table if not exists members(
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  role text not null default 'member' check (role in ('boss','underboss','member')),
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists crime_types(
  id serial primary key,
  category text not null check (category in ('準大型','大型')),
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
  status text default '受付中' check (status in ('受付中','精算中','完了')),
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
  status text default '申請中' check (status in ('未申告','申請中','補填済')),
  note text,
  updated_at timestamptz default now(),
  unique(job_id, member_id)
);

create table if not exists pool_transactions(
  id uuid primary key default gen_random_uuid(),
  type text check (type in ('入金','出金')),
  amount int check (amount>0),
  claim_id uuid references expense_claims(id),
  job_id uuid references crime_jobs(id),
  handled_by uuid references members(id),
  memo text,
  created_at timestamptz default now()
);

-- RLS試運転用（ anonでも操作可、補填・出金はアプリ側でボスゲート。本番厳格化はTODO ）
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
