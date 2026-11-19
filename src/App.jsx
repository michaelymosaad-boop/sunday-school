import { lazy, Suspense, useEffect, useState } from 'react';
import { supabase, loadProfile } from './lib/supabase.js';
import ChangePassword from './pages/ChangePassword.jsx';
import KidPublic from './pages/KidPublic.jsx';
import KidEntry from './pages/KidEntry.jsx';

// الأدمن والخادم فيهم مكتبات تقيلة (Excel، QR) مش لازمة للمخدوم لما بيسحب كارته،
// فبنأجل تحميلهم لحد ما حد فعلاً يدخل كأدمن أو خادم. كده صفحة المخدوم بتفتح بسرعة.
const AdminHome = lazy(() => import('./pages/AdminHome.jsx'));
const ServantHome = lazy(() => import('./pages/ServantHome.jsx'));

function PageLoading() {
  return <div className="grid min-h-screen place-items-center text-slate-500">جاري التحميل...</div>;
}

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
    // شاشة موحدة: المخدوم بيدخل بالكود/QR، الخادم/الأدمن بيدوس "دخول كخادم أو أدمن"
    return <KidEntry onStaff={refresh} />;
  }

  if (profile.must_change_password) {
    return <ChangePassword profile={profile} onDone={refresh} />;
  }

  if (profile.role === 'admin') {
    return (
      <Suspense fallback={<PageLoading />}>
        <AdminHome profile={profile} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<PageLoading />}>
      <ServantHome profile={profile} />
    </Suspense>
  );
}
