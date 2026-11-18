-- ============================================================
-- الكود المختصر للمخدوم + تعديل دخول الصفحة العامة والحضور
-- شغّل الملف ده مرة واحدة في SQL Editor
-- ============================================================

-- ---------- 1) الكود المختصر (6 حروف وأرقام) ----------
alter table public.kids add column if not exists short_code text;

update public.kids
  set short_code = upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6))
  where short_code is null;

alter table public.kids alter column short_code set not null;
alter table public.kids add constraint kids_short_code_key unique (short_code);
alter table public.kids alter column short_code
  set default upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6));

-- ---------- 2) دخول الصفحة العامة: بالكود الكامل أو المختصر ----------
create or replace function public.kid_lookup(p_code text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_kid    public.kids;
  v_cls    text;
  v_points int;
  v_rank   int;
  v_total  int;
  v_scans  jsonb;
begin
  if p_code is null or char_length(trim(p_code)) < 4 then
    return jsonb_build_object('found', false);
  end if;

  select * into v_kid from public.kids
    where (card_code = trim(p_code) or short_code = upper(trim(p_code))) and is_active;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  select name into v_cls from public.classes where id = v_kid.class_id;
  select total_points into v_points from public.public_leaderboard where kid_id = v_kid.id;
  v_points := coalesce(v_points, 0);

  select count(*) + 1 into v_rank from public.public_leaderboard where total_points > v_points;
  select count(*) into v_total from public.public_leaderboard;

  select coalesce(jsonb_agg(jsonb_build_object(
           'date', x.service_date, 'event', x.event_name,
           'position', x.position, 'points', x.points)
         order by x.service_date desc, x.scanned_at desc), '[]'::jsonb)
    into v_scans
    from (
      select s.service_date, e.name as event_name, s.position, s.points, s.scanned_at
      from public.scans s
      join public.events e on e.id = s.event_id
      where s.kid_id = v_kid.id
      order by s.service_date desc, s.scanned_at desc
      limit 60
    ) x;

  return jsonb_build_object(
    'found', true,
    'name', v_kid.full_name,
    'class', v_cls,
    'photo', v_kid.photo_url,
    'points', v_points,
    'rank', v_rank,
    'total', v_total,
    'scans', v_scans
  );
end;
$$;

-- ---------- 3) تسجيل الحضور: بالكود الكامل أو المختصر ----------
create or replace function public.record_scan(p_card_code text, p_event_id bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_kid    public.kids;
  v_ev     public.events;
  v_tier   public.event_tiers;
  v_prev   public.scans;
  v_today  date := (now() at time zone 'Africa/Cairo')::date;
  v_late   int;
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;
  if not public.can_scan_event(p_event_id) then
    raise exception 'event not allowed for this staff';
  end if;

  select * into v_kid from public.kids
    where (card_code = trim(p_card_code) or short_code = upper(trim(p_card_code))) and is_active;
  if not found then
    return jsonb_build_object('type', 'unknown');
  end if;

  select * into v_ev from public.events where id = p_event_id and is_active;
  if not found then
    raise exception 'event not found';
  end if;

  select * into v_prev from public.scans
    where kid_id = v_kid.id and event_id = p_event_id and service_date = v_today;
  if found then
    return jsonb_build_object('type', 'duplicate', 'kid', v_kid.full_name,
                              'scanned_at', v_prev.scanned_at, 'points', v_prev.points);
  end if;

  v_late := floor(extract(epoch from (
              now() - ((v_today + v_ev.start_time) at time zone 'Africa/Cairo')
            )) / 60)::int;

  select * into v_tier from public.event_tiers
    where event_id = p_event_id and (up_to_minutes is null or v_late <= up_to_minutes)
    order by position limit 1;

  insert into public.scans (kid_id, event_id, service_date, minutes_late, position, points, scanned_by)
  values (v_kid.id, p_event_id, v_today, v_late, v_tier.position, v_tier.points, (select auth.uid()));

  return jsonb_build_object('type', 'ok', 'kid', v_kid.full_name,
                            'points', v_tier.points, 'position', v_tier.position);
end;
$$;

revoke execute on function public.record_scan(text, bigint) from public, anon;
grant execute on function public.record_scan(text, bigint) to authenticated;
