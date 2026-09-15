-- 每日任务清单：Supabase 数据库初始化脚本
-- 在 Supabase Dashboard → SQL Editor → New query 中完整执行一次。
-- 此脚本只会新建 tasks 表；不会读取或修改秒哒原数据库。

create table if not exists public.tasks (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 500),
  priority text not null default 'medium'
    check (priority in ('high', 'medium', 'low')),
  completed boolean not null default false,
  reminder_at timestamptz,
  reminder_method text check (reminder_method in ('sound', 'dialog')),
  elapsed_seconds integer not null default 0 check (elapsed_seconds >= 0),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((reminder_at is null) = (reminder_method is null))
);

create index if not exists tasks_user_id_id_idx on public.tasks (user_id, id);
create index if not exists tasks_user_id_created_at_idx
  on public.tasks (user_id, created_at desc);

alter table public.tasks enable row level security;

drop policy if exists "任务仅限本人查看" on public.tasks;
create policy "任务仅限本人查看"
  on public.tasks for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "任务仅限本人新增" on public.tasks;
create policy "任务仅限本人新增"
  on public.tasks for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "任务仅限本人修改" on public.tasks;
create policy "任务仅限本人修改"
  on public.tasks for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "任务仅限本人删除" on public.tasks;
create policy "任务仅限本人删除"
  on public.tasks for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.set_tasks_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_tasks_updated_at();
