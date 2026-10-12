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
