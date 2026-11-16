import { supabase } from '../lib/supabase.js';

export default function ServantHome({ profile }) {
  return (
    <div className="mx-auto max-w-md space-y-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold text-indigo-900">أهلاً {profile.display_name}</h1>
        <button
          onClick={() => supabase.auth.signOut()}
          className="rounded-xl bg-slate-200 px-4 py-2 font-semibold"
        >
          خروج
        </button>
      </header>
      <p className="text-slate-600">شاشة الخادم هتتبني في الخطوة الجاية.</p>
    </div>
  );
}
