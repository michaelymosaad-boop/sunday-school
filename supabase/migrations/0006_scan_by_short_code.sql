-- ============================================================
-- record_scan: قبول short_code بالإضافة للـ card_code
-- (المخدومين المستوردين بدون كارت عندهم short_code بس)
-- شغّل الملف ده مرة واحدة في SQL Editor
-- ============================================================

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

  -- بنبحث بالـ card_code أولاً، لو مش لاقي نجرب short_code
  select * into v_kid from public.kids
    where card_code = p_card_code and is_active;

  if not found then
    select * into v_kid from public.kids
      where short_code = p_card_code and is_active;
  end if;

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
