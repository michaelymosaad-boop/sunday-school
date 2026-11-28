-- ============================================================
-- 0009: صلاحية الوصول الأساسية لجدول event_versions (اتنسيت في 0008)
-- شغّل الملف ده مرة واحدة في SQL Editor
-- ============================================================

grant select on public.event_versions to anon, authenticated;
grant insert, update, delete on public.event_versions to authenticated;
