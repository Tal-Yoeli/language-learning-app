-- Calls the notify-signup Edge Function directly from the database when a
-- new profiles row is inserted, instead of relying on a Database Webhook
-- configured by hand in the dashboard (that UI moves around between Supabase
-- versions and was hard to locate). This achieves the same thing with no
-- manual dashboard step.
--
-- The project URL and anon key below are public values by design — they are
-- already embedded in the app bundle and in .env.example — so committing them
-- here is not a secret exposure. The anon key is only being used so the
-- gateway's `verify_jwt` check on notify-signup passes; notify-signup does
-- not use auth.uid() for anything.
--
-- This migration is additive: it only adds an extension (if missing), a new
-- function, and a new trigger. It does not alter the previous migration.
--
-- Rollback:
--   drop trigger if exists on_profile_created_notify on public.profiles;
--   drop function if exists public.notify_new_signup();

create extension if not exists pg_net;

create or replace function public.notify_new_signup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- Public values (see note above) — not secrets.
  supabase_url constant text := 'https://gxawhrkctjhneasimoek.supabase.co';
  anon_key constant text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4YXdocmtjdGpobmVhc2ltb2VrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNDMyNDksImV4cCI6MjA5NTgxOTI0OX0.rYB4d62rlOmKVlycBGQDRxh_nzDbADXvywz6VgGruUI';
begin
  -- net.http_post queues the request and returns immediately; the actual HTTP
  -- call happens on a background worker so this never blocks the signup.
  perform net.http_post(
    url := supabase_url || '/functions/v1/notify-signup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', anon_key,
      'Authorization', 'Bearer ' || anon_key
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'profiles',
      'record', jsonb_build_object(
        'id', new.id,
        'email', new.email,
        'approval_token', new.approval_token
      )
    )
  );

  return new;
end;
$$;

drop trigger if exists on_profile_created_notify on public.profiles;
create trigger on_profile_created_notify
  after insert on public.profiles
  for each row execute function public.notify_new_signup();
