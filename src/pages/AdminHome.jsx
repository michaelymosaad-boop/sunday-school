import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import AdminKids from './AdminKids.jsx';
import AdminEvents from './AdminEvents.jsx';

export default function AdminHome({ profile }) {
  const [tab, setTab] = useState('home');
  const [counts, setCounts] = useState({ kids: null, classes: null, events: null });

  useEffect(() => {
    async function count(table) {
      const { count: n, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      if (error) throw error;
      return n;
    }
    Promise.all([count('kids'), count('classes'), count('events')])
      .then(([kids, classes, events]) => setCounts({ kids, classes, events }))
      .catch((e) => console.error(e));
  }, [tab]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-indigo-900">لوحة الأدمن</h1>
        <button
          onClick={() => supabase.auth.signOut()}
          className="rounded-xl bg-slate-200 px-4 py-2 font-semibold"
        >
          خروج
        </button>
      </header>

      <nav className="no-print flex flex-wrap gap-2">
        <Tab active={tab === 'home'}   onClick={() => setTab('home')}>الرئيسية</Tab>
        <Tab active={tab === 'kids'}   onClick={() => setTab('kids')}>المخدومين والفصول</Tab>
        <Tab active={tab === 'events'} onClick={() => setTab('events')}>الفعاليات</Tab>
      </nav>

      {tab === 'home' && (
        <>
          <p className="text-slate-600">أهلاً {profile.display_name}. الاتصال بقاعدة البيانات شغّال.</p>
          <div className="grid grid-cols-3 gap-4">
            <Stat label="المخدومين" value={counts.kids} />
            <Stat label="الفصول"    value={counts.classes} />
            <Stat label="الفعاليات" value={counts.events} />
          </div>
        </>
      )}

      {tab === 'kids'   && <AdminKids />}
      {tab === 'events' && <AdminEvents />}
    </div>
  );
}

function Tab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl px-4 py-2 font-bold ${active ? 'bg-indigo-700 text-white' : 'bg-white text-slate-700 shadow'}`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-2xl bg-white p-4 text-center shadow">
      <div className="text-3xl font-extrabold text-indigo-900">{value ?? '…'}</div>
      <div className="text-sm text-slate-500">{label}</div>
    </div>
  );
}
