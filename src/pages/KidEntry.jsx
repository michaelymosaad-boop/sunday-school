import { useState } from 'react';

// شاشة دخول المخدوم: بيكتب الكود المختصر أو الكود الكامل
export default function KidEntry() {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');

  function submit(e) {
    e.preventDefault();
    const c = code.trim();
    if (c.length < 4) return setErr('اكتب الكود كامل');
    window.location.href = `${window.location.pathname}?k=${encodeURIComponent(c)}`;
  }

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 text-center shadow">
        <h1 className="text-xl font-extrabold text-indigo-900">مدارس الأحد</h1>
        <p className="text-slate-600">امسح الـ QR اللي على كارتك، أو اكتب الكود المختصر تحته.</p>

        <form onSubmit={submit} className="space-y-3">
          <input
            className="w-full rounded-xl border border-slate-300 px-3 py-3 text-center text-lg tracking-widest"
            placeholder="الكود"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
          />
          {err && <p className="text-sm font-semibold text-red-600">{err}</p>}
          <button className="w-full rounded-xl bg-indigo-700 py-3 font-bold text-white">دخول</button>
        </form>

      </div>
    </div>
  );
}
