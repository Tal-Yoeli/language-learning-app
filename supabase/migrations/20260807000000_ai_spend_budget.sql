-- Per-user monthly budget for the paid OpenAI features.
--
-- Why this exists: the app is being opened up to family and friends. The old
-- guard counted requests (60/day), which says nothing about cost -- a PDF
-- import and a one-line answer check counted the same. This replaces that with
-- an estimated spend budget of $0.50 per user per calendar month (UTC), while
-- KEEPING the daily request counter as a burst guard, because spend is only
-- recorded after a call returns.
--
-- This is an in-app estimate, not a real billing cap. OpenAI bills the account
-- directly; only OpenAI's own spending limit can hard-stop the bill. This
-- bounds how much any one invited account can cost.
--
-- Money is stored as integer micro-USD (1 USD = 1000000) so repeated addition
-- cannot drift the way numeric/float dollars would.
--
-- Mostly additive: one new column, one new table, two new functions, plus a
-- redefined consume_ai_quota() and handle_new_user().
--
-- NOT purely additive, and deliberately so: this REVOKES insert/update on
-- public.profiles from `authenticated` and DROPS the `profiles_insert_own`
-- policy. Those together let any signed-in user write `approved = true` and an
-- unlimited budget onto their own row, bypassing both the approval gate and
-- this budget. Nothing in the app used them (the client only ever SELECTs from
-- profiles), so no behaviour is lost.
--
-- Rollback (signatures must match what is created below, or these silently
-- no-op and leave security-definer functions pointing at a dropped table):
--   drop function if exists public.record_ai_spend(uuid, date, bigint);
--   drop function if exists public.ai_spend_reservation_micro_usd();
--   drop table if exists public.ai_spend;
--   alter table public.profiles drop column if exists monthly_budget_micro_usd;
--   -- then re-run 20260730000000_user_approval.sql's consume_ai_quota().
--   -- Deliberately do NOT restore the profiles insert/update grants: that is
--   -- the privilege-escalation hole this migration closes.

-- 0 means unlimited. Default is $0.50.
alter table public.profiles
  add column if not exists monthly_budget_micro_usd integer not null default 500000;

-- The owner's unlimited exemption is applied AFTER the backfill further down,
-- because a backfilled owner row would otherwise be created after this point
-- and silently keep the $0.50 default.
--
-- The signup trigger covers the case where the row does not exist yet. On a fresh
-- project the migrations are applied before anyone signs up, so the UPDATE
-- above would match zero rows and the owner would silently end up capped at
-- $0.50 like everyone else.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_email constant text := 'tal.yoeli@gmail.com';
begin
  -- Everyone else takes the column default, so the budget lives in exactly one
  -- place rather than being duplicated into this function.
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  if new.email = owner_email then
    update public.profiles
      set monthly_budget_micro_usd = 0
      where id = new.id;
  end if;

  return new;
end;
$$;

create table if not exists public.ai_spend (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- First day of the UTC month this row accounts for.
  period_month date not null,
  micro_usd bigint not null default 0,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, period_month)
);

alter table public.ai_spend enable row level security;

-- Users may read their own spend so the app can show remaining budget. Nobody
-- writes directly: all increments go through record_ai_spend(), which is
-- security definer.
drop policy if exists "ai_spend_select_own" on public.ai_spend;
create policy "ai_spend_select_own"
  on public.ai_spend for select
  using (auth.uid() = user_id);

-- The provisional charge taken before a call, reconciled afterwards. Defined
-- as a function so consume_ai_quota() and record_ai_spend() cannot drift apart.
-- Sized to the expensive end of a real call, not the average. A deck build
-- costs ~15000 micro-USD under the default price table and a large PDF import
-- more, so a small reservation would let a burst of concurrent requests all
-- pass the budget check before any of their real costs landed -- exactly the
-- overshoot the reservation exists to prevent.
--
-- Over-reserving is harmless for ordinary sequential use: record_ai_spend()
-- reconciles down to the true cost within a second of the call returning. The
-- cost of this choice is that a user with many requests genuinely in flight at
-- once can be told to wait, which is the correct answer anyway.
create or replace function public.ai_spend_reservation_micro_usd()
returns bigint
language sql
immutable
as $$ select 25000::bigint $$;

-- Redefines the existing guard (same name, so the Edge Functions' shared
-- auth helper keeps its shape) to also enforce the monthly budget.
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
  period date := date_trunc('month', (now() at time zone 'utc'))::date;
  budget integer;
  spent bigint;
  used integer;
begin
  if caller is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select p.monthly_budget_micro_usd into budget
  from public.profiles p
  where p.id = caller and p.approved;

  if budget is null then
    raise exception 'Account pending approval' using errcode = '28001';
  end if;

  select coalesce(s.micro_usd, 0) into spent
  from public.ai_spend s
  where s.user_id = caller and s.period_month = period;

  spent := coalesce(spent, 0);

  -- budget = 0 means unlimited.
  if budget > 0 and spent >= budget then
    raise exception 'Monthly AI budget exhausted' using errcode = '28002';
  end if;

  -- Burst guard. Spend lands only after a call completes, so without this a
  -- client could fire many requests before any cost is recorded.
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
      'limit', daily_limit,
      'spentMicroUsd', spent,
      'budgetMicroUsd', budget
    );
  end if;

  -- Debit a provisional charge NOW, before the model is called. Checking the
  -- budget and debiting only afterwards leaves a window where many concurrent
  -- requests all read the same under-budget total and sail past the cap
  -- together; the daily burst limit would be the only thing bounding the
  -- overshoot. record_ai_spend() reconciles this against the real cost.
  --
  -- If a call dies before reconciling, the reservation simply stands, which
  -- errs toward over-counting rather than letting spend escape.
  insert into public.ai_spend as s (user_id, period_month, micro_usd, request_count)
  values (caller, period, public.ai_spend_reservation_micro_usd(), 1)
  on conflict (user_id, period_month) do update
    set micro_usd = s.micro_usd + public.ai_spend_reservation_micro_usd(),
        request_count = s.request_count + 1,
        updated_at = now()
  returning s.micro_usd into spent;

  return jsonb_build_object(
    'allowed', true,
    'used', used,
    'limit', daily_limit,
    'spentMicroUsd', spent,
    'budgetMicroUsd', budget,
    -- Returned so the reconciliation can target exactly the row this
    -- reservation landed in, rather than re-deriving "now" and guessing.
    'userId', caller,
    'periodMonth', period
  );
end;
$$;

-- Reconciles the reservation consume_ai_quota() already took against what the
-- request actually cost. The delta is usually small and can be negative (a
-- refund) when the real cost came in under the reservation.
--
-- SECURITY: this is service-role only, and takes the user and period as
-- arguments rather than reading auth.uid(). Granting it to `authenticated`
-- would hand every user a button that subtracts the reservation on demand --
-- POST {"amount_micro_usd": 0} in a loop and your own spend returns to zero.
-- That is the same self-service hole this migration closes on public.profiles,
-- and it must not be reopened through an RPC.
--
-- Deliberately does NOT touch request_count: consume_ai_quota() already counted
-- the request, and counting again here would double every call.
drop function if exists public.record_ai_spend(bigint);

create or replace function public.record_ai_spend(
  target_user uuid,
  target_period date,
  amount_micro_usd bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  delta bigint :=
    greatest(coalesce(amount_micro_usd, 0), 0)
    - public.ai_spend_reservation_micro_usd();
  total bigint;
begin
  if target_user is null or target_period is null then
    raise exception 'target_user and target_period are required';
  end if;

  update public.ai_spend as s
    set micro_usd = greatest(0, s.micro_usd + delta),
        updated_at = now()
    where s.user_id = target_user and s.period_month = target_period
  returning s.micro_usd into total;

  return jsonb_build_object('spentMicroUsd', coalesce(total, 0));
end;
$$;

-- SECURITY: `profiles_update_own` permits UPDATE on the caller's own row, and
-- Supabase grants `authenticated` full-column UPDATE by default. Together those
-- let any signed-in user PATCH their own row -- setting `approved = true` to
-- walk straight past the admin approval gate, or `monthly_budget_micro_usd = 0`
-- to hand themselves unlimited spend. RLS alone cannot stop this; the fix is
-- column-level privileges.
--
-- The client only ever SELECTs from profiles (src/lib/supabase.ts), so nothing
-- in the app breaks. `approved`, `approval_token` and the budget stay writable
-- only by the security-definer functions and the service role.
revoke update on public.profiles from authenticated;
grant update (native_language, learning_language) on public.profiles to authenticated;

-- INSERT is the same hole by another door: `profiles_insert_own` lets a user
-- create their own row, so anyone WITHOUT one (an account predating the
-- approval migration, or a row that was deleted) could POST themselves a
-- profile with approved = true and an unlimited budget. Rows are only ever
-- created by handle_new_user(), which is security definer and unaffected by
-- this revoke.
revoke insert on public.profiles from authenticated;
drop policy if exists "profiles_insert_own" on public.profiles;

-- Backfill anyone who signed up before handle_new_user() existed, so no
-- account is left without a profile row (which is what made the INSERT path
-- reachable in the first place). Unapproved by default, exactly like a new
-- signup.
--
-- The notify trigger is suspended around this: it fires per inserted row, so a
-- backfill would email the owner a "new sign-up" notice -- each with a live,
-- working approve link -- for every pre-existing account.
do $$
begin
  if exists (
    select 1 from pg_trigger
    where tgname = 'on_profile_created_notify'
      and tgrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles disable trigger on_profile_created_notify;
  end if;
end $$;

insert into public.profiles (id, email)
select u.id, u.email
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

do $$
begin
  if exists (
    select 1 from pg_trigger
    where tgname = 'on_profile_created_notify'
      and tgrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles enable trigger on_profile_created_notify;
  end if;
end $$;

-- Now that every account is guaranteed a row, exempt the owner.
update public.profiles
  set monthly_budget_micro_usd = 0
  where email = 'tal.yoeli@gmail.com';

revoke all on function public.ai_spend_reservation_micro_usd() from public, anon;
grant execute on function public.ai_spend_reservation_micro_usd() to authenticated;
revoke all on function public.consume_ai_quota() from public, anon;
grant execute on function public.consume_ai_quota() to authenticated;
-- No grant to `authenticated`: only the service role may adjust spend.
revoke all on function public.record_ai_spend(uuid, date, bigint)
  from public, anon, authenticated;
grant execute on function public.record_ai_spend(uuid, date, bigint) to service_role;
