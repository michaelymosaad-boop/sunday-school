import { useEffect, useState } from 'react';
import { supabase, loadProfile } from './lib/supabase.js';
import Login from './pages/Login.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import AdminHome from './pages/AdminHome.jsx';
import ServantHome from './pages/ServantHome.jsx';
import KidPublic from './pages/KidPublic.jsx';
import KidEntry from './pages/KidEntry.jsx';

export default function App() {
  const [profile, setProfile] = useState(null);
  const [ready, setReady] = useState(false);

  async function refresh() {
    try {
      setProfile(await loadProfile());
    } catch (e) {
      console.error(e);
      setProfile(null);
    } finally {
      setReady(true);
    }
  }

  useEffect(() => {
    refresh();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) setProfile(null);
      else refresh();
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // دخول المخدوم: الـ QR بيفتح الموقع بالشكل ده ?k=الكود
  const kidCode = new URLSearchParams(window.location.search).get('k');
  if (kidCode) return <KidPublic code={kidCode} />;

  if (!ready) {
    return <div className="grid min-h-screen place-items-center text-slate-500">جاري التحميل...</div>;
  }

  if (!profile || !profile.is_active) {
    // المخدوم يدخل بالكود. الأدمن والخادم كل واحد ليه لينك فيه كلمة تعبر عن صلاحيته
    const params = new URLSearchParams(window.location.search);
    if (params.has('admin')) return <Login onDone={refresh} title="دخول الأدمن" />;
    if (params.has('servant')) return <Login onDone={refresh} title="دخول الخادم" />;
    return <KidEntry />;
  }

  if (profile.must_change_password) {
    return <ChangePassword profile={profile} onDone={refresh} />;
  }

  if (profile.role === 'admin') {
    return <AdminHome profile={profile} />;
  }

  return <ServantHome profile={profile} />;
}
