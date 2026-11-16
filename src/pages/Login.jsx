import { useState } from 'react';
import { supabase } from '../lib/supabase.js';

export default function Login({ onDone }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      // نحوّل اسم المستخدم للإيميل المرتبط بيه
      const { data: email, error: lookupError } = await supabase.rpc('resolve_login', {
        p_login: login,
      });
      if (lookupError) throw lookupError;

      // رسالة واحدة للحالتين عشان ما نقولش الاسم موجود ولا لأ
      if (!email) {
        setError('الاسم أو الرقم السري غير صحيح');
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError('الاسم أو الرقم السري غير صحيح');
        return;
      }
      onDone();
    } catch (err) {
      console.error(err);
      setError('حصلت مشكلة في الاتصال، جرّب تاني');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow">
        <h1 className="text-center text-2xl font-extrabold text-indigo-900">تسجيل الدخول</h1>

        <label className="block space-y-1">
          <span className="text-sm font-semibold text-slate-600">اسم المستخدم</span>
          <input
            className="w-full rounded-xl border border-slate-300 px-3 py-2"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoComplete="username"
            required
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-semibold text-slate-600">الرقم السري</span>
          <input
            type="password"
            className="w-full rounded-xl border border-slate-300 px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error && <p className="text-sm font-semibold text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-indigo-700 py-3 font-bold text-white disabled:opacity-60"
        >
          {busy ? 'جاري الدخول...' : 'دخول'}
        </button>
      </form>
    </div>
  );
}
