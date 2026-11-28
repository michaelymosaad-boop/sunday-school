-- ============================================================
-- 0008: جدولة الفعاليات (أيام أسبوعية / مرة واحدة / تواريخ محددة)
--       + نسخ للإعدادات بتسري من تاريخ معين (التعديل مبيأثرش على اللي فات)
-- شغّل الملف ده كله مرة واحدة في SQL Editor (بعد 0007)
-- ============================================================

create table if not exists public.event_versions (
  id              bigint generated always as identity primary key,
  event_id        bigint not null references public.events(id) on delete cascade,
  effective_from  date not null,                       -- النسخة دي سارية من التاريخ ده
  kind            text not null check (kind in ('weekly','once','dates')),
  weekdays        smallint[] not null default '{}',    -- 0=الأحد ... 6=السبت (للأسبوعي)
  dates           date[] not null default '{}',        -- للمرة الواحدة / التواريخ المحددة
  start_time      time not null,
  end_time        time,
  tiers           jsonb not null default '[]'::jsonb,  -- [{position, up_to_minutes, points}]
  created_at      timestamptz not null default now(),
  unique (event_id, effective_from)
);
create index if not exists event_versions_lookup_idx on public.event_versions (event_id, effective_from desc);

alter table public.event_versions enable row level security;
create policy event_versions_read on public.event_versions for select to anon, authenticated using (true);
create policy event_versions_admin on public.event_versions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- الفعاليات الحالية: نسخة أولى أسبوعية كل الأيام (عشان الشغل الحالي ميقفش)، وبعدين حدد أيامها من لوحة الأدمن
insert into public.event_versions (event_id, effective_from, kind, weekdays, start_time, end_time, tiers)
select e.id, date '2000-01-01', 'weekly', '{0,1,2,3,4,5,6}', e.start_time, e.end_time,
       coalesce((
         select jsonb_agg(jsonb_build_object(
                  'position', t.position, 'up_to_minutes', t.up_to_minutes, 'points', t.points)
                order by t.position)
         from public.event_tiers t where t.event_id = e.id
       ), '[]'::jsonb)
from public.events e
on conflict (event_id, effective_from) do nothing;

-- النسخة السارية في يوم معين (لو الفعالية مش شغالة اليوم ده بترجّع صف فاضي)
create or replace function public.event_version_on(p_event_id bigint, p_date date)
returns public.event_versions language sql stable security definer set search_path = ''
as $$
  select x.* from (
    select v.* from public.event_versions v
    where v.event_id = p_event_id and v.effective_from <= p_date
    order by v.effective_from desc
    limit 1
  ) x
  where (x.kind = 'weekly' and extract(dow from p_date)::smallint = any (x.weekdays))
     or (x.kind in ('once','dates') and p_date = any (x.dates));
$$;
revoke execute on function public.event_version_on(bigint, date) from public, anon;
grant execute on function public.event_version_on(bigint, date) to authenticated;

-- فعاليات النهارده المسموحة للخادم الحالي (الأدمن يشوف كلها)
create or replace function public.my_events_today()
returns table (id bigint, name text, start_time time, end_time time)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.name, v.start_time, v.end_time
  from public.events e
  cross join lateral public.event_version_on(e.id, (now() at time zone 'Africa/Cairo')::date) v
  where e.is_active and v.id is not null
    and public.is_staff() and public.can_scan_event(e.id)
  order by v.start_time;
$$;
revoke execute on function public.my_events_today() from public, anon;
grant execute on function public.my_events_today() to authenticated;

-- record_scan: بيشتغل بالنسخة السارية النهارده (يوم + وقت + نقط)
create or replace function public.record_scan(p_card_code text, p_event_id bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_kid    public.kids;
  v_ev     public.events;
  v_ver    public.event_versions;
  v_prev   public.scans;
  v_today  date := (now() at time zone 'Africa/Cairo')::date;
  v_now    time := (now() at time zone 'Africa/Cairo')::time;
  v_late   int;
  v_pos    int;
  v_points int;
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;
  if not public.can_scan_event(p_event_id) then
    raise exception 'event not allowed for this staff';
  end if;

  select * into v_kid from public.kids where card_code = p_card_code and is_active;
  if not found then
    select * into v_kid from public.kids where short_code = p_card_code and is_active;
  end if;
  if not found then
    return jsonb_build_object('type', 'unknown');
  end if;

  select * into v_ev from public.events where id = p_event_id and is_active;
  if not found then
    raise exception 'event not found';
  end if;

  select * into v_ver from public.event_version_on(p_event_id, v_today);
  if v_ver.id is null then
    return jsonb_build_object('type', 'not_today');
  end if;

  if v_ver.end_time is not null and v_now > v_ver.end_time then
    return jsonb_build_object('type', 'closed', 'end_time', v_ver.end_time);
  end if;

  select * into v_prev from public.scans
    where kid_id = v_kid.id and event_id = p_event_id and service_date = v_today;
  if found then
    return jsonb_build_object('type', 'duplicate', 'kid', v_kid.full_name,
                              'scanned_at', v_prev.scanned_at, 'points', v_prev.points);
  end if;

  v_late := floor(extract(epoch from (
              now() - ((v_today + v_ver.start_time) at time zone 'Africa/Cairo')
            )) / 60)::int;

  select (t->>'position')::int, (t->>'points')::int into v_pos, v_points
  from jsonb_array_elements(v_ver.tiers) t
  where (t->>'up_to_minutes') is null or v_late <= (t->>'up_to_minutes')::int
  order by (t->>'position')::int
  limit 1;

  if v_pos is null then
    raise exception 'no points tier configured for this event';
  end if;

  insert into public.scans (kid_id, event_id, service_date, minutes_late, position, points, scanned_by)
  values (v_kid.id, p_event_id, v_today, v_late, v_pos, v_points, (select auth.uid()));

  return jsonb_build_object('type', 'ok', 'kid', v_kid.full_name,
                            'points', v_points, 'position', v_pos);
end;
$$;

-- undo_scan: وقت النهاية من النسخة اللي كانت سارية يوم التسجيل
create or replace function public.undo_scan(p_scan_id bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_scan public.scans;
  v_ver  public.event_versions;
  v_now  time := (now() at time zone 'Africa/Cairo')::time;
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;

  select * into v_scan from public.scans where id = p_scan_id;
  if not found then
    return jsonb_build_object('type', 'missing');
  end if;

  if not public.is_admin() and v_scan.scanned_by is distinct from (select auth.uid()) then
    raise exception 'not your scan';
  end if;

  select * into v_ver from public.event_version_on(v_scan.event_id, v_scan.service_date);
  if not public.is_admin()
     and (v_scan.service_date <> (now() at time zone 'Africa/Cairo')::date
          or (v_ver.end_time is not null and v_now > v_ver.end_time)) then
    return jsonb_build_object('type', 'closed');
  end if;

  delete from public.scans where id = p_scan_id;
  return jsonb_build_object('type', 'ok');
end;
$$;
