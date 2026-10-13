-- 周计划独立存储；不修改已有每日任务。
begin;
create table if not exists public.weekly_tasks (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  name text not null check (char_length(btrim(name)) between 1 and 500),
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists weekly_tasks_user_week_id_idx on public.weekly_tasks(user_id, week_start, id);
alter table public.weekly_tasks enable row level security;
revoke all on public.weekly_tasks from anon;
grant select, insert, update, delete on public.weekly_tasks to authenticated;
drop policy if exists weekly_tasks_owner on public.weekly_tasks;
create policy weekly_tasks_owner on public.weekly_tasks for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create or replace function public.set_weekly_tasks_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists weekly_tasks_updated_at on public.weekly_tasks;
create trigger weekly_tasks_updated_at before update on public.weekly_tasks
for each row execute function public.set_weekly_tasks_updated_at();
commit;
