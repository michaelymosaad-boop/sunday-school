import { useEffect, useState } from 'react';
import { supabase, loadProfile } from './lib/supabase.js';
import Login from './pages/Login.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import AdminHome from './pages/AdminHome.jsx';
import ServantHome from './pages/ServantHome.jsx';

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

  if (!ready) {
    return <div className="grid min-h-screen place-items-center text-slate-500">جاري التحميل...</div>;
  }

  if (!profile || !profile.is_active) {
    return <Login onDone={refresh} />;
  }

  if (profile.must_change_password) {
    return <ChangePassword profile={profile} onDone={refresh} />;
  }

  if (profile.role === 'admin') {
    return <AdminHome profile={profile} />;
  }

  return <ServantHome profile={profile} />;
}
