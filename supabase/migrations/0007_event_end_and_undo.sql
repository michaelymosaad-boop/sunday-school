-- ============================================================
-- 0007: وقت نهاية الفعالية + التراجع عن تسجيل غلط
-- شغّل الملف ده كله مرة واحدة في SQL Editor
-- ============================================================

-- 1) وقت نهاية الفعالية (بتوقيت القاهرة). فاضي = مفيش حد أقصى
alter table public.events add column if not exists end_time time;

-- 2) record_scan: ممنوع التسجيل بعد نهاية الفعالية
create or replace function public.record_scan(p_card_code text, p_event_id bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_kid    public.kids;
  v_ev     public.events;
  v_tier   public.event_tiers;
  v_prev   public.scans;
  v_today  date := (now() at time zone 'Africa/Cairo')::date;
  v_now    time := (now() at time zone 'Africa/Cairo')::time;
  v_late   int;
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

  -- بعد نهاية الفعالية: مفيش تسجيل
  if v_ev.end_time is not null and v_now > v_ev.end_time then
    return jsonb_build_object('type', 'closed', 'end_time', v_ev.end_time);
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

-- 3) التراجع: الخادم يلغي تسجيله هو بس، قبل نهاية الفعالية. الأدمن يلغي أي تسجيل
create or replace function public.undo_scan(p_scan_id bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_scan public.scans;
  v_ev   public.events;
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

  select * into v_ev from public.events where id = v_scan.event_id;
  if not public.is_admin()
     and v_ev.end_time is not null
     and (v_scan.service_date <> (now() at time zone 'Africa/Cairo')::date or v_now > v_ev.end_time) then
    return jsonb_build_object('type', 'closed');
  end if;

  delete from public.scans where id = p_scan_id;
  return jsonb_build_object('type', 'ok');
end;
$$;

revoke execute on function public.undo_scan(bigint) from public, anon;
grant execute on function public.undo_scan(bigint) to authenticated;
