-- ============================================================
-- 0010: kid_lookup بيرجّع كمان kid_id (عشان نقدر نحدد "أنا" في الترتيب العام)
-- شغّل الملف ده مرة واحدة في SQL Editor
-- ============================================================

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
    'kid_id', v_kid.id,
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
