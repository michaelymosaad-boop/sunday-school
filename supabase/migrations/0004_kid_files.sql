-- ============================================================
-- تخزين صور المخدومين وصور الكروت في Supabase Storage
-- شغّل الملف ده مرة واحدة في SQL Editor
-- ============================================================

-- ---------- 1) المخازن ----------
-- صور المخدومين: عامة (بتظهر في الصفحة العامة)
-- صور الكروت: خاصة (فيها كود الدخول، الأدمن بس يشوفها)
insert into storage.buckets (id, name, public)
values ('kid-photos', 'kid-photos', true),
       ('kid-cards', 'kid-cards', false)
on conflict (id) do nothing;

-- ---------- 2) مسار صورة الكارت داخل الجدول ----------
alter table public.kids add column if not exists card_image_path text;

-- ---------- 3) الأدمن يقدر يشوف صور الكروت ----------
create policy kid_cards_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'kid-cards' and public.is_admin());
