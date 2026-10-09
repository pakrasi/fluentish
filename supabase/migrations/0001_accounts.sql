-- Fluentish accounts, stage 2 (docs/ACCOUNTS.md). Committed in stage 0 and NOT run: the owner pastes it into the SQL
-- editor of his own project at stage 2, then runs supabase/tests/rls.sql, where every check must print ok.
--
-- The tables mirror the progress backup's Files port (src/data/sync/backup.js: read, write, list by path), so the
-- account is a second backup target with the same files and the same merge. Events and cards tables come in stage 4.
-- Row level security on every table; the Data API sees them only through the explicit grants below (from
-- 30 Oct 2026 new public tables are not exposed by default). anon gets nothing.

begin;

create table public.profiles (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  local_id   uuid not null,                                   -- the local profile that created it (the claim's source)
  name       text not null default '' check (char_length(name) <= 40),
  created_at timestamptz not null default now(),
  unique (owner_id, local_id)
);

create table public.devices (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  id         text not null check (id ~ '^[A-Za-z0-9_-]{1,64}$'),   -- data/ids.js newDeviceId, as backup.js deviceDir writes it
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  primary key (profile_id, id)
);

create table public.files (                                    -- backup.js Files {read, write, list}
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- exactly the paths backup.js writes: eventsPath, snapshotPath, logPath
  path       text not null check (path ~ '^data/(events|snapshots|logs)/[A-Za-z0-9_-]{1,64}/(\d{4}-\d{2}-\d{2}|undated)\.(ndjson|json|json\.gz)$'),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  encoding   text not null check (encoding in ('utf8', 'base64')),   -- .gz snapshots travel as base64
  body       text not null check (octet_length(body) <= 4194304),
  sha        text not null default '',                        -- set by the trigger: the optimistic-concurrency token
  size       integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (profile_id, path)
);
create index files_owner on public.files (owner_id);

-- The per-account quota in bytes (200 MB). A function so supabase/tests/rls.sql can lower it inside its transaction.
create function public.files_quota() returns bigint language sql stable set search_path = '' as $$ select 209715200::bigint $$;

-- sha, size, updated_at and the quota are set on the server, never trusted from the client
create function public.files_stamp() returns trigger language plpgsql set search_path = '' as $$
begin
  new.sha := encode(sha256(convert_to(new.body, 'UTF8')), 'hex');
  new.size := octet_length(new.body);
  new.updated_at := now();
  if (select coalesce(sum(f.size), 0) from public.files f
        where f.owner_id = new.owner_id and not (f.profile_id = new.profile_id and f.path = new.path))
     + new.size > public.files_quota() then
    raise exception 'quota exceeded' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger files_stamp before insert or update on public.files for each row execute function public.files_stamp();

-- at most 5 profiles per account
create function public.profiles_limit() returns trigger language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.profiles p where p.owner_id = new.owner_id) >= 5 then
    raise exception 'profile limit' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger profiles_limit before insert on public.profiles for each row execute function public.profiles_limit();

alter table public.profiles enable row level security;
alter table public.devices  enable row level security;
alter table public.files    enable row level security;

-- Data API exposure is explicit
revoke all on public.profiles, public.devices, public.files from anon;
grant select, insert, update, delete on public.profiles, public.devices, public.files to authenticated;
revoke execute on function public.files_quota() from public, anon;
grant execute on function public.files_quota() to authenticated;

-- (select auth.uid()) is evaluated once per statement; `to authenticated` skips the policy for anon altogether
create policy profiles_own on public.profiles for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

create policy devices_own on public.devices for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id and exists (
    select 1 from public.profiles p where p.id = profile_id and p.owner_id = (select auth.uid())));

create policy files_own on public.files for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id and exists (
    select 1 from public.profiles p where p.id = profile_id and p.owner_id = (select auth.uid())));

commit;
