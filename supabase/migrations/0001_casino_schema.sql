-- P12 schema for Casino Tycoon.
-- Target project: vhzpdgjktszmyjeppjqi. The org's OTHER project is live
-- GridClash data whose `profiles`/`leaderboard` tables collide by name — a
-- dedicated project exists specifically so a mistake here cannot reach it.

-- Installed into `extensions`, not `public`: an extension in the public schema
-- is flagged by Supabase's security advisor, and every reference below is
-- schema-qualified anyway.
create extension if not exists unaccent with schema extensions;

-- profiles: the single source of truth for a player's public name.
create table profiles (
  user_id      uuid primary key references auth.users on delete cascade,
  display_name text not null,
  created_at   timestamptz not null default now(),
  constraint name_len   check (char_length(display_name) between 3 and 16),
  -- POSIX class, not \p{L}: Postgres regex has no Unicode property escapes.
  constraint name_chars check (display_name ~ '^[[:alnum:] _-]+$')
);
create unique index profiles_name_unique on profiles (lower(display_name));

-- saves: fully private, one row per (player, slot). Autosave never syncs.
create table saves (
  user_id    uuid not null references auth.users on delete cascade,
  slot       text not null check (slot in ('slot-1','slot-2','slot-3')),
  payload    jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, slot)
);

-- leaderboard: one row per (campaign, player); the name comes from the join.
-- The FK points at `profiles`, NOT auth.users: PostgREST can only embed
-- `profiles(display_name)` if a foreign key between the two tables exists, and
-- posting a score already requires a claimed name, so this is also the truer
-- constraint. profiles itself cascades from auth.users, so account deletion
-- still reaches these rows.
create table leaderboard (
  campaign_id       text not null,
  user_id           uuid not null references profiles (user_id) on delete cascade,
  best_daily_profit numeric not null,
  completed_in_days integer not null,
  score             numeric not null,
  updated_at        timestamptz not null default now(),
  primary key (campaign_id, user_id)
);

-- Editable without a redeploy.
create table banned_words (word text primary key);

alter table profiles     enable row level security;
alter table saves        enable row level security;
alter table leaderboard  enable row level security;
alter table banned_words enable row level security;

create policy "profiles readable by all"  on profiles for select using (true);
create policy "profiles writable by self" on profiles for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "saves private" on saves for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "board readable by all" on leaderboard for select using (true);
create policy "board writable by self" on leaderboard for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- banned_words: no policy at all => readable/writable by nobody through
-- PostgREST. The trigger runs as definer and bypasses RLS.

-- Normalization must match normalizeName() in src/services/nameFilter.ts
-- step for step, or a name blocked on the client would pass the real gate here:
--   lowercase -> unaccent -> leet-fold -> drop non-alphanumerics -> collapse
--   any run of 3+ identical characters down to one.
-- stable, not immutable: extensions.unaccent(text) is only stable.
create or replace function normalize_name(raw text)
returns text language sql stable set search_path = '' as $$
  select regexp_replace(
    regexp_replace(
      translate(lower(extensions.unaccent(raw)), '43105$@', 'aeiossa'),
      '[^a-z0-9]', '', 'g'
    ),
    '(.)\1{2,}', '\1', 'g'
  );
$$;

create or replace function check_display_name()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  norm text := public.normalize_name(new.display_name);
begin
  if exists (
    select 1 from public.banned_words b
    where norm ~ ('\m' || b.word || '\M')
  ) then
    raise exception 'display_name_blocked' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger profiles_name_check
  before insert or update of display_name on profiles
  for each row execute function check_display_name();

-- Best-of merge, mirroring LocalLeaderboard.record's max/min/max exactly.
-- security invoker: runs as the caller, so RLS applies and auth.uid()
-- cannot be spoofed by passing a user id as a parameter.
create or replace function record_win(
  p_campaign text, p_profit numeric, p_day int, p_score numeric
) returns void language sql security invoker set search_path = '' as $$
  -- Aliased because ON CONFLICT DO UPDATE can only reference the target
  -- relation by its bare name or alias, never schema-qualified.
  insert into public.leaderboard as lb
    (campaign_id, user_id, best_daily_profit, completed_in_days, score)
  values (p_campaign, auth.uid(), p_profit, p_day, p_score)
  on conflict (campaign_id, user_id) do update set
    best_daily_profit = greatest(lb.best_daily_profit, excluded.best_daily_profit),
    completed_in_days = least   (lb.completed_in_days, excluded.completed_in_days),
    score             = greatest(lb.score,             excluded.score),
    updated_at        = now();
$$;
