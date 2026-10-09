-- RLS checks for supabase/migrations/0001_accounts.sql (docs/ACCOUNTS.md). Run in the SQL editor of the project,
-- after the migration, as the default postgres role. It makes two throwaway users, acts as each through
-- request.jwt.claims and `set local role`, and deletes them again; the last statement lists every check, and each
-- must say ok. Nothing is left behind: a failure aborts the transaction, and the users are deleted at the end
-- (on delete cascade removes their rows). Not run yet (stage 0): the first run is the owner's, at stage 2.

begin;

create temp table rls_results (n serial primary key, check_name text not null, result text not null) on commit preserve rows;

do $$
declare
  a  uuid := '00000000-0000-4000-8000-0000000000a1';
  b  uuid := '00000000-0000-4000-8000-0000000000b1';
  pa uuid; pb uuid;
  n  int;
  s  text;
  ok boolean;
  names text[] := '{}';
  oks text[] := '{}';
  ev text := 'data/events/deva0001/2026-10-20.ndjson';
begin
  insert into auth.users (id, aud, role, email) values
    (a, 'authenticated', 'authenticated', 'rls-a@example.invalid'),
    (b, 'authenticated', 'authenticated', 'rls-b@example.invalid');

  -- ---------- user A writes a profile, a device and a file ----------
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a::text, true);
  execute 'set local role authenticated';
  insert into public.profiles (local_id) values (gen_random_uuid()) returning id into pa;
  insert into public.devices (profile_id, id) values (pa, 'deva0001');
  insert into public.files (profile_id, path, encoding, body, sha, size) values (pa, ev, 'utf8', E'{"id":"e1"}\n', 'client-sha', 1);
  select f.sha, f.size into s, n from public.files f where f.profile_id = pa and f.path = ev;
  names := array_append(names, 'sha and size are set by the server'::text); oks := array_append(oks, (s = encode(sha256(convert_to(E'{"id":"e1"}\n', 'UTF8')), 'hex') and n = 12)::text);
  select count(*) into n from public.files;
  names := array_append(names, 'A reads its own file'::text); oks := array_append(oks, (n = 1)::text);

  -- ---------- user B: sees, changes and takes nothing of A's ----------
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', b::text, true);
  select count(*) into n from public.profiles;  names := array_append(names, 'B reads no profile of A'::text); oks := array_append(oks, (n = 0)::text);
  select count(*) into n from public.devices;   names := array_append(names, 'B reads no device of A'::text); oks := array_append(oks, (n = 0)::text);
  select count(*) into n from public.files;     names := array_append(names, 'B reads no file of A'::text); oks := array_append(oks, (n = 0)::text);
  update public.files set body = 'x' where profile_id = pa; get diagnostics n = row_count;
  names := array_append(names, 'B updates no file of A'::text); oks := array_append(oks, (n = 0)::text);
  delete from public.files where profile_id = pa; get diagnostics n = row_count;
  names := array_append(names, 'B deletes no file of A'::text); oks := array_append(oks, (n = 0)::text);
  update public.profiles set name = 'x' where id = pa; get diagnostics n = row_count;
  names := array_append(names, 'B renames no profile of A'::text); oks := array_append(oks, (n = 0)::text);
  begin
    insert into public.files (profile_id, path, encoding, body) values (pa, 'data/events/devb0001/2026-10-20.ndjson', 'utf8', 'x');
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  names := array_append(names, 'B cannot write a file into A''s profile'::text); oks := array_append(oks, ok::text);
  begin
    insert into public.devices (profile_id, id) values (pa, 'devb0001');
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  names := array_append(names, 'B cannot add a device to A''s profile'::text); oks := array_append(oks, ok::text);
  begin
    insert into public.profiles (owner_id, local_id) values (a, gen_random_uuid());
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  names := array_append(names, 'B cannot create a profile owned by A'::text); oks := array_append(oks, ok::text);
  insert into public.profiles (local_id) values (gen_random_uuid()) returning id into pb;
  begin
    update public.profiles set owner_id = a where id = pb;
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  names := array_append(names, 'B cannot hand its profile to A'::text); oks := array_append(oks, ok::text);

  -- ---------- limits and checks ----------
  for i in 1..4 loop insert into public.profiles (local_id) values (gen_random_uuid()); end loop;
  begin
    insert into public.profiles (local_id) values (gen_random_uuid());
    ok := false;
  exception when raise_exception then ok := sqlerrm = 'profile limit';
  end;
  names := array_append(names, 'a sixth profile is refused'::text); oks := array_append(oks, ok::text);
  begin
    insert into public.files (profile_id, path, encoding, body) values (pb, 'data/attempts/devb0001/2026-10-20.json', 'utf8', 'x');
    ok := false;
  exception when check_violation then ok := true;
  end;
  names := array_append(names, 'a path outside data/events|snapshots|logs is refused'::text); oks := array_append(oks, ok::text);

  -- the quota, lowered to 20 bytes for this transaction (the owner of the function is postgres)
  execute 'reset role';
  execute 'create or replace function public.files_quota() returns bigint language sql stable set search_path = '''' as $q$ select 20::bigint $q$';
  execute 'set local role authenticated';
  insert into public.files (profile_id, path, encoding, body) values (pb, 'data/events/devb0001/2026-10-20.ndjson', 'utf8', '123456789012345');
  begin
    insert into public.files (profile_id, path, encoding, body) values (pb, 'data/events/devb0001/2026-10-21.ndjson', 'utf8', '1234567890');
    ok := false;
  exception when raise_exception then ok := sqlerrm = 'quota exceeded';
  end;
  names := array_append(names, 'a write over the account quota is refused'::text); oks := array_append(oks, ok::text);
  update public.files set body = '123456789012345678' where profile_id = pb and path = 'data/events/devb0001/2026-10-20.ndjson';
  get diagnostics n = row_count;
  names := array_append(names, 'rewriting a file counts its new size only'::text); oks := array_append(oks, (n = 1)::text);
  update public.files set body = 'y' where profile_id = pb and path = 'data/events/devb0001/2026-10-20.ndjson' and sha = 'stale';
  get diagnostics n = row_count;
  names := array_append(names, 'a write with a stale sha changes 0 rows'::text); oks := array_append(oks, (n = 0)::text);
  execute 'reset role';
  execute 'create or replace function public.files_quota() returns bigint language sql stable set search_path = '''' as $q$ select 209715200::bigint $q$';

  -- ---------- anon: nothing at all ----------
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
  foreach s in array array['profiles', 'devices', 'files'] loop
    begin
      execute format('select count(*) from public.%I', s) into n;
      ok := false;
    exception when insufficient_privilege then ok := true;
    end;
    names := array_append(names, format('anon cannot read %s', s)::text); oks := array_append(oks, ok::text);
  end loop;
  execute 'reset role';

  -- ---------- clean up: deleting the users removes every row ----------
  delete from auth.users where id in (a, b);
  select count(*) into n from public.profiles where owner_id in (a, b);
  names := array_append(names, 'deleting a user removes its rows'::text); oks := array_append(oks, (n = 0)::text);

  for i in 1..array_length(names, 1) loop
    insert into rls_results (check_name, result) values (names[i], case when oks[i] = 'true' then 'ok' else 'FAIL' end);
  end loop;
end $$;

commit;

select n, check_name, result from rls_results order by n;
