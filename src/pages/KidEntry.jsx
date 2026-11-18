import { useState } from 'react';
import QrScanner from '../components/QrScanner.jsx';

// شاشة دخول المخدوم: مسح الـ QR بالكاميرا، أو كتابة الكود المختصر
export default function KidEntry() {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [scanning, setScanning] = useState(false);

  function openKid(value) {
    const c = value.trim();
    if (c.length < 4) return setErr('اكتب الكود كامل');
    window.location.href = `${window.location.pathname}?k=${encodeURIComponent(c)}`;
  }

  function submit(e) {
    e.preventDefault();
    openKid(code);
  }

  // الـ QR ممكن يكون لينك للموقع (فيه ?k=) أو الكود نفسه
  function onScanned(text) {
    if (text.startsWith('http')) {
      window.location.href = text;
      return;
    }
    openKid(text);
  }

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 text-center shadow">
        <h1 className="text-xl font-extrabold text-indigo-900">مدارس الأحد</h1>

        {scanning ? (
          <QrScanner onResult={onScanned} onClose={() => setScanning(false)} />
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
                onChange={(e) => setCode(e.target.value)}
                autoCapitalize="characters"
                autoComplete="off"
              />
              {err && <p className="text-sm font-semibold text-red-600">{err}</p>}
              <button className="w-full rounded-xl bg-indigo-700 py-3 font-bold text-white">دخول</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
