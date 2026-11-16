-- ============================================================
-- تسجيل الدخول باسم المستخدم (مش بالإيميل)
-- Supabase Auth بيحتاج إيميل، فالدالة دي بتحوّل الاسم للإيميل
-- ============================================================

create or replace function public.resolve_login(p_login text)
returns text language sql stable security definer set search_path = ''
as $$
  select u.email::text
  from public.profiles p
  join auth.users u on u.id = p.id
  where lower(p.login_name) = lower(trim(p_login)) and p.is_active
  limit 1;
$$;

revoke execute on function public.resolve_login(text) from public;
grant execute on function public.resolve_login(text) to anon, authenticated;
