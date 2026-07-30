-- Admin-approved accounts.
--
-- Why this exists: the app is moving from anonymous/local-first to real
-- accounts that Tal must approve before someone can use the app at all. A new
-- signup gets a `profiles` row with `approved = false`; a database webhook
-- (configured in the dashboard, not here) notifies Tal by email with a
-- one-click approve link, which flips the flag.
--
-- This migration is additive/idempotent. It creates `profiles` if it does not
-- already exist (matching supabase/schema.sql), adds two columns if it does
-- exist without them, adds a trigger on auth.users, and redefines
-- consume_ai_quota() (same function, `create or replace`) to also require
-- approval. Nothing existing is dropped or destructively altered.
--
-- Rollback:
--   drop trigger if exists on_auth_user_created on auth.users;
--   drop function if exists public.handle_new_user();
--   alter table public.profiles drop column if exists approved;
--   alter table public.profiles drop column if exists approval_token;
--   -- then re-run supabase/migrations/20260728000000_ai_usage_quota.sql's
--   -- consume_ai_quota() definition to drop the approval check.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  native_language text not null default 'he',
  learning_language text not null default 'en',
  created_at timestamptz not null default now(),
  approved boolean not null default false,
  approval_token uuid not null default gen_random_uuid()
);

alter table public.profiles add column if not exists approved boolean not null default false;
alter table public.profiles add column if not exists approval_token uuid not null default gen_random_uuid();

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Creates the matching profiles row the moment someone signs up, so approval
-- state exists from the very first instant and can't be skipped by a client
-- that never gets around to inserting its own row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Redefines the existing quota function (same name/signature) to also
-- require approval, checked before the daily-limit logic. Signed-in-but-
-- unapproved callers get a distinct errcode so the Edge Function can tell
-- "pending approval" apart from "over quota" and from "not signed in".
create or replace function public.consume_ai_quota()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  daily_limit constant integer := 60;
  caller uuid := auth.uid();
  today date := (now() at time zone 'utc')::date;
  used integer;
begin
  if caller is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = caller and approved
  ) then
    raise exception 'Account pending approval' using errcode = '28001';
  end if;

  insert into public.ai_usage as u (user_id, usage_date, request_count)
  values (caller, today, 1)
  on conflict (user_id, usage_date) do update
    set request_count = u.request_count + 1,
        updated_at = now()
    where u.request_count < daily_limit
  returning u.request_count into used;

  if used is null then
    select u.request_count into used
    from public.ai_usage u
    where u.user_id = caller and u.usage_date = today;

    return jsonb_build_object(
      'allowed', false,
      'used', coalesce(used, daily_limit),
      'limit', daily_limit
    );
  end if;

  return jsonb_build_object('allowed', true, 'used', used, 'limit', daily_limit);
end;
$$;

revoke all on function public.consume_ai_quota() from public, anon;
grant execute on function public.consume_ai_quota() to authenticated;
