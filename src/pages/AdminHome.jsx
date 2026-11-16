import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

export default function AdminHome({ profile }) {
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
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-indigo-900">لوحة الأدمن</h1>
        <button
          onClick={() => supabase.auth.signOut()}
          className="rounded-xl bg-slate-200 px-4 py-2 font-semibold"
        >
          خروج
        </button>
      </header>

      <p className="text-slate-600">أهلاً {profile.display_name}. الاتصال بقاعدة البيانات شغّال.</p>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="المخدومين" value={counts.kids} />
        <Stat label="الفصول" value={counts.classes} />
        <Stat label="الفعاليات" value={counts.events} />
      </div>

      <p className="text-sm text-slate-500">الخطوة الجاية: إدارة المخدومين والفصول والفعاليات.</p>
    </div>
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
