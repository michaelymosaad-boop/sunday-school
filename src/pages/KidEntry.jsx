import { lazy, Suspense, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// مكتبة قراءة QR تقيلة، بنأجل تحميلها لحد ما حد يدوس على "امسح بالكاميرا" فعلاً
const QrScanner = lazy(() => import('../components/QrScanner.jsx'));

// شاشة الدخول الموحدة:
//  - المخدوم: بيمسح الـ QR أو بيكتب كوده المختصر
//  - الخادم/الأدمن: بيدوس "دخول كخادم أو أدمن" ويشوف فورم يوزر+باسورد
export default function KidEntry({ onStaff }) {
  const [code, setCode]       = useState('');
  const [err, setErr]         = useState('');
  const [scanning, setScanning] = useState(false);
  const [staffMode, setStaffMode] = useState(false);

  /* ——— مخدوم: دخول بالكارت / الكود ——— */
  function openKid(value) {
    const c = value.trim();
    if (c.length < 4) return setErr('اكتب الكود كامل');
    window.location.href = `${window.location.pathname}?k=${encodeURIComponent(c)}`;
  }

  function submit(e) {
    e.preventDefault();
    openKid(code);
  }

  function onScanned(text) {
    if (text.startsWith('http')) {
      window.location.href = text;
      return;
    }
    openKid(text);
  }

  /* ——— خادم / أدمن: فورم يوزر+باسورد ——— */
  if (staffMode) {
    return <StaffLogin onCancel={() => setStaffMode(false)} onDone={onStaff} />;
  }

  /* ——— الشاشة الرئيسية ——— */
  return (
    <div className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 text-center shadow">
        <h1 className="text-xl font-extrabold text-indigo-900">مدارس الأحد</h1>

        {scanning ? (
          <Suspense fallback={<p className="text-slate-500">جاري فتح الكاميرا...</p>}>
            <QrScanner onResult={onScanned} onClose={() => setScanning(false)} />
          </Suspense>
        ) : (
          <>
            <p className="text-slate-600">امسح الـ QR اللي على كارتك، أو اكتب الكود المختصر تحته.</p>

            <button
              type="button"
              onClick={() => setScanning(true)}
              className="w-full rounded-xl bg-amber-400 py-3 font-bold text-amber-950"
            >
              📷 امسح الكارت بالكاميرا
            </button>

            <div className="flex items-center gap-2 text-sm text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              أو
              <span className="h-px flex-1 bg-slate-200" />
            </div>

            <form onSubmit={submit} className="space-y-3">
              <input
                className="w-full rounded-xl border border-slate-300 px-3 py-3 text-center text-lg tracking-widest"
                placeholder="الكود"
                value={code}
                onChange={(e) => { setCode(e.target.value); setErr(''); }}
                autoCapitalize="characters"
                autoComplete="off"
              />
              {err && <p className="text-sm font-semibold text-red-600">{err}</p>}
              <button className="w-full rounded-xl bg-indigo-700 py-3 font-bold text-white">دخول</button>
            </form>

            {/* زرار الخدام/الأدمن — واضح بس مش بارز عشان ما يتضايقش المخدومين */}
            <div className="border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setStaffMode(true)}
                className="text-sm text-slate-400 underline underline-offset-2 hover:text-slate-600"
              >
                دخول كخادم أو أدمن
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ——— فورم الخادم/الأدمن ——— */
function StaffLogin({ onCancel, onDone }) {
  const [email, setEmail]   = useState('');
  const [pass, setPass]     = useState('');
  const [err, setErr]       = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
      if (onDone) onDone();
    } catch (e) {
      setErr(e.message === 'Invalid login credentials' ? 'البريد أو كلمة السر غلط' : e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow">
        <h1 className="text-xl font-extrabold text-indigo-900 text-center">دخول الخدام والأدمن</h1>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="text"
            className="w-full rounded-xl border border-slate-300 px-3 py-3"
            placeholder="البريد الإلكتروني"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            inputMode="email"
            required
            dir="ltr"
          />
          <input
            type="password"
            className="w-full rounded-xl border border-slate-300 px-3 py-3"
            placeholder="كلمة السر"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoComplete="current-password"
            required
            dir="ltr"
          />
          {err && <p className="text-sm font-semibold text-red-600 text-center">{err}</p>}
          <button
            className="w-full rounded-xl bg-indigo-700 py-3 font-bold text-white disabled:opacity-50"
            disabled={loading}
          >
            {loading ? '...' : 'دخول'}
          </button>
        </form>

        <button
          type="button"
          onClick={onCancel}
          className="w-full text-sm text-slate-400 underline underline-offset-2"
        >
          رجوع
        </button>
      </div>
    </div>
  );
}
