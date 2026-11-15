-- ============================================================
-- مدارس الأحد: الجداول الأساسية + الصلاحيات (RLS) + دالة المسح
-- شغّل الملف ده كله مرة واحدة في SQL Editor
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- 1) الإعدادات (صف واحد بس) ----------
create table public.church_settings (
  id              int primary key default 1 check (id = 1),
  church_name     text not null default '',
  service_name    text not null default 'مدارس الأحد',
  message         text not null default '',
  logo_url        text,
  emblem_url      text,
  theme           jsonb not null default '{}'::jsonb,
  identity_lock   boolean not null default false,   -- تثبيت اسم المخدوم على جهازه
  identity_penalty int not null default 10 check (identity_penalty >= 0),
  -- أسماء الفترات وعدد النجوم لكل فترة (بالترتيب: الأولى، التانية، بعد كده)
  star_levels     jsonb not null default
    '[{"label":"في الموعد","stars":3},{"label":"متأخر قليلاً","stars":2},{"label":"متأخر","stars":1}]'::jsonb
);
insert into public.church_settings (id) values (1);

-- ---------- 2) الفصول والمخدومين ----------
create table public.classes (
  id    bigint generated always as identity primary key,
  name  text not null unique
);

create table public.kids (
  id          bigint generated always as identity primary key,
  full_name   text not null,                                   -- الاسم الثلاثي (ده اللي بيظهر)
  class_id    bigint not null references public.classes(id) on delete restrict,
  card_code   text not null unique default encode(extensions.gen_random_bytes(4), 'hex'),  -- كود الكارت (الـ QR)
  photo_url   text,                                            -- رابط صورة من Google Drive
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index kids_class_id_idx on public.kids(class_id);

-- ---------- 3) الفعاليات وفتراتها ----------
create table public.events (
  id          bigint generated always as identity primary key,
  name        text not null,
  start_time  time not null,                 -- بتوقيت القاهرة
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.event_tiers (
  id              bigint generated always as identity primary key,
  event_id        bigint not null references public.events(id) on delete cascade,
  position        smallint not null check (position >= 1),   -- 1 أول فترة، 2 تانيها، ...
  up_to_minutes   int check (up_to_minutes >= 0),            -- null = الفترة المفتوحة (بعد كده)
  points          int not null default 0 check (points >= 0),
  unique (event_id, position)
);

-- ---------- 4) المسح (الحضور) ----------
create table public.scans (
  id            bigint generated always as identity primary key,
  kid_id        bigint not null references public.kids(id) on delete cascade,
  event_id      bigint not null references public.events(id) on delete cascade,
  service_date  date not null default ((now() at time zone 'Africa/Cairo')::date),
  scanned_at    timestamptz not null default now(),
  minutes_late  int not null,                  -- سالب لو جه قبل الميعاد
  position      smallint not null,             -- الفترة اللي اتحسب منها
  points        int not null,
  scanned_by    uuid references auth.users(id),
  -- القيد ده هو اللي بيمنع التكرار: أول مسح بس هو اللي بيتحسب في اليوم
  unique (kid_id, event_id, service_date)
);
create index scans_event_date_idx on public.scans(event_id, service_date);

-- ---------- 5) التعديلات اليدوية (سجل مطبّق) ----------
create table public.point_adjustments (
  id          bigint generated always as identity primary key,
  kid_id      bigint not null references public.kids(id) on delete cascade,
  points      int not null check (points <> 0),              -- موجب إضافة، سالب خصم
  reason      text not null check (char_length(trim(reason)) >= 3),
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index point_adjustments_kid_idx on public.point_adjustments(kid_id);

-- ---------- 6) الطلبات اللي محتاجة موافقة ----------
create table public.requests (
  id            bigint generated always as identity primary key,
  kind          text not null check (kind in ('adjust_points','add_kid','edit_event','identity_fix')),
  payload       jsonb not null,
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by  uuid not null references auth.users(id),
  decided_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);
create index requests_status_idx on public.requests(status);
create index requests_requested_by_idx on public.requests(requested_by);

-- ---------- 7) ربط الجهاز بالمخدوم (تثبيت الاسم) ----------
create table public.device_identities (
  device_id  text primary key,
  kid_id     bigint not null references public.kids(id) on delete cascade,
  locked_at  timestamptz not null default now()
);

-- ---------- 8) الأدمن والخدام ----------
create table public.profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  role                  text not null check (role in ('admin','servant')),
  login_name            text not null unique,              -- الاسم اللي بيدخل بيه (الرباعي للخدام)
  display_name          text not null,                     -- الثلاثي اللي بيظهر (لو ظهر أصلاً)
  must_change_password  boolean not null default true,
  -- كل صلاحية: none = ممنوع، direct = مباشر، approve = بعد موافقة الأدمن
  permissions           jsonb not null default
    '{"adjust":"none","add_kid":"none","edit_event":"none","reports":"none"}'::jsonb,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now()
);

create table public.staff_events (
  staff_id  uuid not null references public.profiles(id) on delete cascade,
  event_id  bigint not null references public.events(id) on delete cascade,
  primary key (staff_id, event_id)
);
create index staff_events_event_idx on public.staff_events(event_id);

-- ---------- 9) الأوسمة ----------
create table public.badges (
  id            bigint generated always as identity primary key,
  name          text not null,
  metric        text not null check (metric in ('attend','ontime','streak','points','rank')),
  min_value     int not null check (min_value > 0),
  window_weeks  int not null default 0 check (window_weeks >= 0),   -- 0 = كل الفترات
  event_ids     bigint[] not null default '{}',                     -- فاضي = كل الفعاليات
  hue           int not null default 200,
  created_at    timestamptz not null default now()
);

-- ============================================================
-- دوال مساعدة
-- ============================================================
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin' and p.is_active
  );
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  );
$$;

create or replace function public.can_scan_event(p_event_id bigint)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1 from public.staff_events se
    where se.staff_id = (select auth.uid()) and se.event_id = p_event_id
  );
$$;

-- ============================================================
-- دالة المسح: كل الحساب هنا على السيرفر، والخادم ما يقدرش يغيّر أي حاجة
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

  select * into v_kid from public.kids where card_code = p_card_code and is_active;
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

  -- الدقايق من بداية الفعالية (بتوقيت القاهرة)
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

-- الخادم بيأكد إنه غيّر الباسورد
create or replace function public.finish_password_change()
returns void language sql security definer set search_path = ''
as $$
  update public.profiles set must_change_password = false where id = (select auth.uid());
$$;
revoke execute on function public.finish_password_change() from public, anon;
grant execute on function public.finish_password_change() to authenticated;

-- ============================================================
-- العرض العام: الترتيب بيتقرأ من هنا بس (من غير كود الكارت ولا بيانات حساسة)
-- ============================================================
create view public.public_leaderboard as
select
  k.id            as kid_id,
  k.full_name,
  k.photo_url,
  c.name          as class_name,
  (select coalesce(sum(s.points), 0) from public.scans s where s.kid_id = k.id)
  + (select coalesce(sum(a.points), 0) from public.point_adjustments a where a.kid_id = k.id)
                  as total_points
from public.kids k
join public.classes c on c.id = k.class_id
where k.is_active;

grant select on public.public_leaderboard to anon, authenticated;

-- ============================================================
-- الصلاحيات (RLS): كل جدول مقفول الأول، وبعدين بنفتح اللي محتاجينه
-- ============================================================
alter table public.church_settings    enable row level security;
alter table public.classes            enable row level security;
alter table public.kids               enable row level security;
alter table public.events             enable row level security;
alter table public.event_tiers        enable row level security;
alter table public.scans              enable row level security;
alter table public.point_adjustments  enable row level security;
alter table public.requests           enable row level security;
alter table public.device_identities  enable row level security;
alter table public.profiles           enable row level security;
alter table public.staff_events       enable row level security;
alter table public.badges             enable row level security;

-- الإعدادات والفصول والفعاليات والأوسمة: قراءة للكل، والتعديل للأدمن
create policy settings_read on public.church_settings for select to anon, authenticated using (true);
create policy settings_admin on public.church_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy classes_read on public.classes for select to anon, authenticated using (true);
create policy classes_admin on public.classes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy events_read on public.events for select to anon, authenticated using (true);
create policy events_admin on public.events for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy tiers_read on public.event_tiers for select to anon, authenticated using (true);
create policy tiers_admin on public.event_tiers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy badges_read on public.badges for select to anon, authenticated using (true);
create policy badges_admin on public.badges for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- المخدومين: الخدام يشوفوا، والأدمن يعدّل. مفيش قراءة للـ anon (عشان كود الكارت)
create policy kids_staff_read on public.kids for select to authenticated using (public.is_staff());
create policy kids_admin on public.kids for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- المسح والتعديلات: قراءة للخدام، والكتابة بس من الدوال أو الأدمن
create policy scans_staff_read on public.scans for select to authenticated using (public.is_staff());

create policy adjust_staff_read on public.point_adjustments for select to authenticated using (public.is_staff());
create policy adjust_admin on public.point_adjustments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- الطلبات: الخادم يشوف طلباته، والأدمن يشوف الكل ويقرر
create policy requests_read on public.requests for select to authenticated
  using (requested_by = (select auth.uid()) or public.is_admin());
create policy requests_insert on public.requests for insert to authenticated
  with check (requested_by = (select auth.uid()) and public.is_staff());
create policy requests_decide on public.requests for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ربط الجهاز: مفيش أي وصول مباشر، بيتعمل من دوال بس
-- (device_identities: RLS مفعّل من غير أي policy = مقفول)

-- الحسابات: كل واحد يشوف نفسه، والأدمن يشوف ويعدّل الكل
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());
create policy profiles_admin on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy staff_events_read on public.staff_events for select to authenticated
  using (staff_id = (select auth.uid()) or public.is_admin());
create policy staff_events_admin on public.staff_events for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- الترتيب بيعتمد على قراءة عامة من الـ View، فمحتاجين نتأكد إن الـ anon ما يقدرش يكتب
-- ============================================================
revoke insert, update, delete on all tables in schema public from anon;
