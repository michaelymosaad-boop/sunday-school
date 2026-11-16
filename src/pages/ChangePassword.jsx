import { useState } from 'react';
import { supabase } from '../lib/supabase.js';

// الأدمن: 8 حروف على الأقل وفيها حروف وأرقام
const RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

export default function ChangePassword({ profile, onDone }) {
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (pw1 !== pw2) return setError('الرقمين مش متطابقين');
    if (!RULE.test(pw1)) return setError('لازم 8 حروف على الأقل، فيها حروف وأرقام');

    setBusy(true);
    try {
      const { error: updError } = await supabase.auth.updateUser({ password: pw1 });
      if (updError) throw updError;
      const { error: rpcError } = await supabase.rpc('finish_password_change');
      if (rpcError) throw rpcError;
      onDone();
    } catch (err) {
      console.error(err);
      setError('ما قدرناش نغيّر الرقم السري، جرّب تاني');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow">
        <h1 className="text-center text-xl font-extrabold text-indigo-900">
          أهلاً {profile.display_name}، غيّر الرقم السري
        </h1>
        <p className="text-sm text-slate-500">لازم تغيّره قبل ما تكمل.</p>

        <input
          type="password"
          placeholder="الرقم السري الجديد"
          className="w-full rounded-xl border border-slate-300 px-3 py-2"
          value={pw1}
          onChange={(e) => setPw1(e.target.value)}
          autoComplete="new-password"
          required
        />
        <input
          type="password"
          placeholder="تأكيد الرقم السري"
          className="w-full rounded-xl border border-slate-300 px-3 py-2"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          autoComplete="new-password"
          required
        />

        {error && <p className="text-sm font-semibold text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-indigo-700 py-3 font-bold text-white disabled:opacity-60"
        >
          حفظ
        </button>
      </form>
    </div>
  );
}
