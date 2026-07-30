create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  native_language text not null default 'he',
  learning_language text not null default 'en',
  created_at timestamptz not null default now()
);

create table if not exists public.flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  term text not null,
  translation text not null,
  example text,
  source text not null default 'manual',
  created_at timestamptz not null default now()
);

create table if not exists public.card_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  flashcard_id uuid not null references public.flashcards(id) on delete cascade,
  result text not null check (result in ('known', 'missed')),
  reviewed_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.flashcards enable row level security;
alter table public.card_reviews enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "flashcards_crud_own"
  on public.flashcards for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "card_reviews_crud_own"
  on public.card_reviews for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
