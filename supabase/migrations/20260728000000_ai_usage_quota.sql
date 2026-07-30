-- Per-user daily quota for the paid OpenAI Edge Functions.
--
-- Why this exists: `functions.invoke` sends the project anon key as the JWT
-- when there is no session, and the anon key is public by design. On a mobile
-- build that key is at least buried in an app bundle; on a public website it is
-- plain text in the JavaScript. Without this, anyone who views source can spend
-- the project's OpenAI budget.
--
-- This migration is purely additive. It creates one new table and one function
-- and does not read, alter, or drop anything that already exists.
--
-- Rollback:
--   drop function if exists public.consume_ai_quota();
--   drop table if exists public.ai_usage;

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default (now() at time zone 'utc')::date,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

alter table public.ai_usage enable row level security;

-- Users may read their own usage. Nobody writes directly: all increments go
-- through consume_ai_quota(), which is security definer.
drop policy if exists "ai_usage_select_own" on public.ai_usage;
create policy "ai_usage_select_own"
  on public.ai_usage for select
  using (auth.uid() = user_id);

-- The daily limit is a constant inside the function rather than an argument,
-- so a client cannot call the RPC with a larger limit of its own choosing.
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
  -- The project anon key carries role 'anon' and no subject, so auth.uid() is
  -- null for it. This is the check that separates a real (anonymous) user
  -- session from someone replaying the public key.
  if caller is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  -- The WHERE clause makes the increment itself the limit check, so two
  -- concurrent requests cannot both slip past the boundary.
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
