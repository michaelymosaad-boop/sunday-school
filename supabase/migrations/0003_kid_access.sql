-- ============================================================
-- دخول المخدوم بالكارت + البيانات الخاصة (للأدمن بس)
-- شغّل الملف ده مرة واحدة في SQL Editor
-- ============================================================

-- ---------- 1) بيانات خاصة: تاريخ الميلاد والتليفون (الأدمن بس) ----------
create table public.kid_details (
  kid_id      bigint primary key references public.kids(id) on delete cascade,
  birth_date  date,
  phone       text
);

alter table public.kid_details enable row level security;

create policy kid_details_admin on public.kid_details for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- 2) دخول المخدوم بالكارت ----------
-- بترجع بيانات عامة بس: الاسم والفصل والصورة والنقاط والمركز والحضور.
-- ما بترجعش كود الكارت ولا أي بيانات خاصة.
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
  if p_code is null or char_length(p_code) < 4 then
    return jsonb_build_object('found', false);
  end if;

  select * into v_kid from public.kids where card_code = p_code and is_active;
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

revoke execute on function public.kid_lookup(text) from public;
grant execute on function public.kid_lookup(text) to anon, authenticated;
