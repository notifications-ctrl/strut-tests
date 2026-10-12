-- BSD Strut Tests: database setup. Run once in a new Supabase project.
create extension if not exists pgcrypto with schema extensions;

create table public.settings (
  id int primary key default 1 check (id = 1),
  start_150 int not null default 900,
  start_100 int not null default 600,
  drop_150 int not null default 400,
  drop_100 int not null default 300,
  max_tests int not null default 8,
  factory_pin_hash text,
  admin_pin_hash text
);
insert into public.settings (id) values (1);

create table public.testers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.stock (
  stroke int not null check (stroke in (100, 150)),
  force_n int not null check (force_n > 0),
  primary key (stroke, force_n)
);
insert into public.stock (stroke, force_n)
select 150, f from generate_series(400, 1300, 50) f
union all select 100, f from generate_series(250, 600, 50) f;

create table public.rooflights (
  id uuid primary key,
  reference text not null,
  length_mm int,
  width_mm int,
  anti_noise boolean not null default false,
  pairs int not null default 2 check (pairs between 1 and 6),
  lid int not null check (lid in (1, 2)),
  tester_id uuid references public.testers(id) on delete set null,
  finished boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.tests (
  id uuid primary key,
  rooflight_id uuid not null references public.rooflights(id) on delete cascade,
  test_no int not null,
  force_150 int not null,
  force_100 int not null,
  part1 text not null check (part1 in ('flies','smooth','slow','stops','nomove')),
  part2 text not null check (part2 in ('flies','smooth','slow','stops','nomove')),
  seq_answer text check (seq_answer in ('yes','no','notsure')),
  temperature text check (temperature in ('cold','mild','warm')),
  note text,
  tester_id uuid references public.testers(id) on delete set null,
  tested_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index tests_rooflight_idx on public.tests (rooflight_id);
create index tests_tester_idx on public.tests (tester_id);
create index rooflights_tester_idx on public.rooflights (tester_id);

create table public.pin_failures (
  id bigserial primary key,
  at timestamptz not null default now()
);

-- Tables are closed to the browser; it can only call the PIN-checked functions below.
alter table public.settings enable row level security;
alter table public.testers enable row level security;
alter table public.stock enable row level security;
alter table public.rooflights enable row level security;
alter table public.tests enable row level security;
alter table public.pin_failures enable row level security;
revoke all on public.settings, public.testers, public.stock, public.rooflights, public.tests, public.pin_failures from anon, authenticated;

-- 'admin', 'factory', 'locked' or null. Logs failures; locks for 10 minutes after 30 wrong PINs.
create or replace function public._pin_role(p_pin text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare s public.settings; recent int;
begin
  select count(*) into recent from public.pin_failures where at > now() - interval '10 minutes';
  if recent >= 30 then return 'locked'; end if;
  select * into s from public.settings where id = 1;
  if p_pin is not null and s.admin_pin_hash is not null and crypt(p_pin, s.admin_pin_hash) = s.admin_pin_hash then return 'admin'; end if;
  if p_pin is not null and s.factory_pin_hash is not null and crypt(p_pin, s.factory_pin_hash) = s.factory_pin_hash then return 'factory'; end if;
  insert into public.pin_failures default values;
  delete from public.pin_failures where at < now() - interval '1 day';
  return null;
end $$;

create or replace function public._bad(r text) returns json language sql immutable set search_path = public as $$
  select json_build_object('error', case when r = 'locked' then 'locked' else 'pin' end)
$$;

create or replace function public._config() returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'testers', coalesce((select json_agg(json_build_object('id', id, 'name', name) order by name) from public.testers where active), '[]'),
    'stock150', coalesce((select json_agg(force_n order by force_n) from public.stock where stroke = 150), '[]'),
    'stock100', coalesce((select json_agg(force_n order by force_n) from public.stock where stroke = 100), '[]'),
    'settings', (select json_build_object('start_150', start_150, 'start_100', start_100, 'drop_150', drop_150, 'drop_100', drop_100, 'max_tests', max_tests) from public.settings where id = 1)
  )
$$;

create or replace function public.app_config(p_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare r text := public._pin_role(p_pin);
begin
  if r is null or r = 'locked' then return public._bad(r); end if;
  return public._config()::jsonb || jsonb_build_object('role', r);
end $$;

create or replace function public.app_save_rooflight(p_pin text, p jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r text := public._pin_role(p_pin);
begin
  if r is null or r = 'locked' then return public._bad(r); end if;
  insert into public.rooflights (id, reference, length_mm, width_mm, anti_noise, pairs, lid, tester_id, finished, created_at)
  values ((p->>'id')::uuid, p->>'reference', (p->>'length_mm')::int, (p->>'width_mm')::int,
          coalesce((p->>'anti_noise')::boolean, false), coalesce((p->>'pairs')::int, 2), (p->>'lid')::int,
          (select id from public.testers where id = (p->>'tester_id')::uuid),
          coalesce((p->>'finished')::boolean, false), coalesce((p->>'created_at')::timestamptz, now()))
  on conflict (id) do update set finished = excluded.finished;
  return json_build_object('ok', true);
end $$;

create or replace function public.app_save_test(p_pin text, p jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r text := public._pin_role(p_pin);
begin
  if r is null or r = 'locked' then return public._bad(r); end if;
  insert into public.tests (id, rooflight_id, test_no, force_150, force_100, part1, part2, seq_answer, temperature, note, tester_id, tested_at)
  values ((p->>'id')::uuid, (p->>'rooflight_id')::uuid, (p->>'test_no')::int, (p->>'force_150')::int, (p->>'force_100')::int,
          p->>'part1', p->>'part2', nullif(p->>'seq_answer', ''), nullif(p->>'temperature', ''), nullif(p->>'note', ''),
          (select id from public.testers where id = (p->>'tester_id')::uuid), (p->>'tested_at')::timestamptz)
  on conflict (id) do nothing;
  return json_build_object('ok', true);
end $$;

create or replace function public.app_open_rooflights(p_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare r text := public._pin_role(p_pin);
begin
  if r is null or r = 'locked' then return public._bad(r); end if;
  return json_build_object('rooflights', coalesce((
    select json_agg(row_to_json(x) order by x.created_at desc) from (
      select rl.*, coalesce((select json_agg(t order by t.test_no) from public.tests t where t.rooflight_id = rl.id), '[]') as tests
      from public.rooflights rl where not rl.finished and rl.created_at > now() - interval '60 days'
    ) x), '[]'));
end $$;

create or replace function public.admin_data(p_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare r text := public._pin_role(p_pin);
begin
  if r is distinct from 'admin' then return public._bad(r); end if;
  return json_build_object(
    'rooflights', coalesce((select json_agg(rl order by rl.created_at desc) from public.rooflights rl), '[]'),
    'tests', coalesce((select json_agg(t order by t.rooflight_id, t.test_no) from public.tests t), '[]'),
    'testers', coalesce((select json_agg(te order by te.name) from public.testers te), '[]'),
    'stock150', coalesce((select json_agg(force_n order by force_n) from public.stock where stroke = 150), '[]'),
    'stock100', coalesce((select json_agg(force_n order by force_n) from public.stock where stroke = 100), '[]'),
    'settings', (select json_build_object('start_150', start_150, 'start_100', start_100, 'drop_150', drop_150, 'drop_100', drop_100, 'max_tests', max_tests) from public.settings where id = 1));
end $$;

create or replace function public.admin_save_tester(p_pin text, p_id uuid, p_name text, p_active boolean)
returns json language plpgsql security definer set search_path = public as $$
declare r text := public._pin_role(p_pin);
begin
  if r is distinct from 'admin' then return public._bad(r); end if;
  if coalesce(trim(p_name), '') = '' then return json_build_object('error', 'Enter a name.'); end if;
  if p_id is null then
    insert into public.testers (name, active) values (trim(p_name), coalesce(p_active, true));
  else
    update public.testers set name = trim(p_name), active = coalesce(p_active, active) where id = p_id;
  end if;
  return json_build_object('ok', true);
exception when unique_violation then
  return json_build_object('error', 'That name is already on the list.');
end $$;

create or replace function public.admin_save_stock(p_pin text, p_150 int[], p_100 int[])
returns json language plpgsql security definer set search_path = public as $$
declare r text := public._pin_role(p_pin);
begin
  if r is distinct from 'admin' then return public._bad(r); end if;
  if coalesce(array_length(p_150, 1), 0) = 0 or coalesce(array_length(p_100, 1), 0) = 0 then
    return json_build_object('error', 'Each stroke needs at least one force.');
  end if;
  delete from public.stock where true;
  insert into public.stock (stroke, force_n) select distinct 150, f from unnest(p_150) f where f > 0;
  insert into public.stock (stroke, force_n) select distinct 100, f from unnest(p_100) f where f > 0;
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_save_settings(p_pin text, p jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r text := public._pin_role(p_pin);
begin
  if r is distinct from 'admin' then return public._bad(r); end if;
  update public.settings set
    start_150 = coalesce((p->>'start_150')::int, start_150),
    start_100 = coalesce((p->>'start_100')::int, start_100),
    drop_150 = coalesce((p->>'drop_150')::int, drop_150),
    drop_100 = coalesce((p->>'drop_100')::int, drop_100),
    max_tests = coalesce((p->>'max_tests')::int, max_tests)
  where id = 1;
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_set_pin(p_pin text, p_which text, p_new text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare r text := public._pin_role(p_pin);
begin
  if r is distinct from 'admin' then return public._bad(r); end if;
  if p_new !~ '^[0-9]{4,12}$' then return json_build_object('error', 'Use 4 to 12 digits.'); end if;
  if p_which = 'factory' then update public.settings set factory_pin_hash = crypt(p_new, gen_salt('bf')) where id = 1;
  elsif p_which = 'admin' then update public.settings set admin_pin_hash = crypt(p_new, gen_salt('bf')) where id = 1;
  else return json_build_object('error', 'Unknown PIN.'); end if;
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_delete_rooflight(p_pin text, p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare r text := public._pin_role(p_pin);
begin
  if r is distinct from 'admin' then return public._bad(r); end if;
  delete from public.rooflights where id = p_id;
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_set_finished(p_pin text, p_id uuid, p_finished boolean)
returns json language plpgsql security definer set search_path = public as $$
declare r text := public._pin_role(p_pin);
begin
  if r is distinct from 'admin' then return public._bad(r); end if;
  update public.rooflights set finished = p_finished where id = p_id;
  return json_build_object('ok', true);
end $$;

-- Only the app_* and admin_* functions are callable from the browser.
revoke all on function public._pin_role(text), public._bad(text), public._config() from public, anon, authenticated;
revoke all on function public.app_config(text), public.app_save_rooflight(text, jsonb), public.app_save_test(text, jsonb),
  public.app_open_rooflights(text), public.admin_data(text), public.admin_save_tester(text, uuid, text, boolean),
  public.admin_save_stock(text, int[], int[]), public.admin_save_settings(text, jsonb), public.admin_set_pin(text, text, text),
  public.admin_delete_rooflight(text, uuid), public.admin_set_finished(text, uuid, boolean) from public, authenticated;
grant execute on function public.app_config(text), public.app_save_rooflight(text, jsonb), public.app_save_test(text, jsonb),
  public.app_open_rooflights(text), public.admin_data(text), public.admin_save_tester(text, uuid, text, boolean),
  public.admin_save_stock(text, int[], int[]), public.admin_save_settings(text, jsonb), public.admin_set_pin(text, text, text),
  public.admin_delete_rooflight(text, uuid), public.admin_set_finished(text, uuid, boolean) to anon;

insert into public.testers (name) values ('Gordon');
-- BSD Strut Tests: update 2. Lets phones learn from earlier rooflights. Run once.
create or replace function public.app_history(p_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare r text := public._pin_role(p_pin);
begin
  if r is null or r = 'locked' then return public._bad(r); end if;
  return json_build_object('rooflights', coalesce((
    select json_agg(json_build_object(
      'id', rl.id, 'length_mm', rl.length_mm, 'width_mm', rl.width_mm, 'anti_noise', rl.anti_noise,
      'tests', (select json_agg(json_build_object('force_150', t.force_150, 'force_100', t.force_100, 'part1', t.part1, 'part2', t.part2))
                from public.tests t where t.rooflight_id = rl.id)))
    from public.rooflights rl
    where exists (select 1 from public.tests t where t.rooflight_id = rl.id)
      and rl.reference not ilike 'SIM-%'   -- simulated test rooflights are not real data
  ), '[]'));
end $$;
revoke all on function public.app_history(text) from public, authenticated;
grant execute on function public.app_history(text) to anon;
