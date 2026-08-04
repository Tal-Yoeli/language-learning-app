-- Cross-device sync for the learner's library and activity.
--
-- Why this exists: until now every device kept its own copy in AsyncStorage /
-- localStorage, so signing into the same account on a laptop and a phone
-- showed two unrelated libraries. This stores both documents against the
-- account so they follow the user.
--
-- The two documents are stored as jsonb exactly as the app already shapes
-- them (nested languages -> decks -> cards, plus the activity/XP record).
-- They are deliberately NOT normalised into the unused flat `flashcards` /
-- `card_reviews` tables in schema.sql: those have a different shape and no
-- spaced-repetition fields, and remapping would mean rewriting the app's
-- persistence layer for no practical gain at this scale.
--
-- Each document carries its own timestamp so the library and the activity
-- record resolve independently; the client compares these against its local
-- timestamps to decide which side is newer.
--
-- Additive only: one new table, nothing existing is read, altered or dropped.
--
-- Rollback:
--   drop table if exists public.user_state;

create table if not exists public.user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  library jsonb,
  activity jsonb,
  library_updated_at timestamptz,
  activity_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.user_state enable row level security;

-- Owner-only, mirroring the existing profiles_select_own / ai_usage_select_own
-- policies. There is no cross-user access of any kind.
drop policy if exists "user_state_select_own" on public.user_state;
create policy "user_state_select_own"
  on public.user_state for select
  using (auth.uid() = user_id);

drop policy if exists "user_state_insert_own" on public.user_state;
create policy "user_state_insert_own"
  on public.user_state for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_state_update_own" on public.user_state;
create policy "user_state_update_own"
  on public.user_state for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
