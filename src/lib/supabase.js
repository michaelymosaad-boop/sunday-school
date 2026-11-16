import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error('ناقص VITE_SUPABASE_URL أو VITE_SUPABASE_ANON_KEY في ملف .env.local');
}

export const supabase = createClient(url, key);

// تحميل بيانات الحساب الحالي (الدور وحالة الباسورد)
export async function loadProfile() {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, login_name, display_name, must_change_password, is_active')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}
