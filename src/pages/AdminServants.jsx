import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// إدارة الخدام: إنشاء حساب + تحديد الفعاليات + تفعيل/إيقاف + مسح

export default function AdminServants() {
  const [servants, setServants] = useState([]);
  const [events,   setEvents]   = useState([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // فورم إضافة خادم جديد
  const [showForm,     setShowForm]     = useState(false);
  const [loginName,    setLoginName]    = useState('');
  const [password,     setPassword]     = useState('');
  const [selectedEvts, setSelectedEvts] = useState(new Set()); // event ids المختارة

  // تأكيد حذف
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // توسيع بطاقة الخادم لتعديل الفعاليات
  const [expandedId, setExpandedId] = useState(null);
  // الفعاليات المعدّلة في وضع التعديل
  const [editEvts, setEditEvts] = useState(new Set());

  async function load() {
    const [{ data: sData, error: sErr }, { data: eData, error: eErr }] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, login_name, display_name, is_active, role, staff_events(event_id)')
        .eq('role', 'servant')
        .order('display_name'),
      supabase
        .from('events')
        .select('id, name, is_active')
        .order('name'),
    ]);
    if (sErr) throw sErr;
    if (eErr) throw eErr;
    setServants(sData);
    setEvents(eData);
  }

  useEffect(() => { load().catch((e) => setErr(e.message)); }, []);

  async function run(fn) {
    setBusy(true); setErr(''); setMsg('');
    try { await fn(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  // ——— إضافة خادم جديد ———
  async function addServant(e) {
    e.preventDefault();
    const login   = loginName.trim();
    const display = login; // اسم واحد بيُستخدم للدخول وللعرض
    const pass    = password.trim();
    if (!login || !display || !pass) return setErr('كمّل كل البيانات');
    if (pass.length < 8) return setErr('كلمة السر لازم تكون 8 حروف على الأقل');

    run(async () => {
      // إنشاء الحساب بيتم على السيرفر (Edge Function) لأنه محتاج service_role
      const { data: fnData, error: fnErr } = await supabase.functions.invoke('create-servant', {
        body: {
          login_name:   login,
          display_name: display,
          password:     pass,
          event_ids:    [...selectedEvts],
        },
      });
      if (fnErr) throw fnErr;
      if (fnData?.error) throw new Error(fnData.error);

      setMsg(`تم إنشاء حساب "${display}"`);
      setLoginName(''); setPassword(''); setSelectedEvts(new Set());
      setShowForm(false);
      await load();
    });
  }

  // ——— تفعيل / إيقاف خادم ———
  function toggleActive(s) {
    run(async () => {
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: !s.is_active })
        .eq('id', s.id);
      if (error) throw error;
      setMsg(s.is_active ? `تم إيقاف "${s.display_name}"` : `تم تفعيل "${s.display_name}"`);
      await load();
    });
  }

  // ——— حذف خادم ———
  function deleteServant(s) {
    run(async () => {
      // الحذف بيتم من الـ Edge Function عشان يمسح حساب الدخول نفسه
      const { data, error } = await supabase.functions.invoke('create-servant', {
        body: { action: 'delete', id: s.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setConfirmDeleteId(null);
      setMsg(`تم حذف "${s.display_name}"`);
      await load();
    });
  }

  // ——— تعديل فعاليات خادم موجود ———
  function openEdit(s) {
    setExpandedId(s.id);
    setEditEvts(new Set(s.staff_events.map((se) => se.event_id)));
  }

  function saveEventAssignments(s) {
    run(async () => {
      // 1) امسح القديم
      const { error: delErr } = await supabase.from('staff_events').delete().eq('staff_id', s.id);
      if (delErr) throw delErr;
      // 2) اضف الجديد
      if (editEvts.size > 0) {
        const rows = [...editEvts].map((eid) => ({ staff_id: s.id, event_id: eid }));
        const { error: insErr } = await supabase.from('staff_events').insert(rows);
        if (insErr) throw insErr;
      }
      setMsg(`تم تحديث فعاليات "${s.display_name}"`);
      setExpandedId(null);
      await load();
    });
  }

  function toggleEvt(id, setter) {
    setter((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      {msg && <p className="rounded-xl bg-emerald-50 p-3 font-semibold text-emerald-700">{msg}</p>}
      {err && <p className="rounded-xl bg-red-50 p-3 font-semibold text-red-600">{err}</p>}

      {/* ——— هيدر + زرار إضافة ——— */}
      <section className="rounded-2xl bg-white p-5 shadow space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-indigo-900">الخدام ({servants.length})</h2>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-xl bg-indigo-700 px-4 py-2 font-bold text-white"
          >
            {showForm ? 'إلغاء' : '+ خادم جديد'}
          </button>
        </div>

        {/* ——— فورم الإضافة ——— */}
        {showForm && (
          <form onSubmit={addServant} autoComplete="off" className="space-y-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
            <h3 className="font-bold text-indigo-800">خادم جديد</h3>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-sm font-semibold text-slate-600">اسم الخادم (ده اللي هيدخل بيه)</span>
                <input
                  name="servant-name"
                  autoComplete="off"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  placeholder="مثال: مرقس بطرس حنا"
                  value={loginName}
                  onChange={(e) => setLoginName(e.target.value)}
                  required
                  dir="rtl"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-semibold text-slate-600">كلمة السر (8 حروف على الأقل)</span>
                <input
                  type="password"
                  name="servant-password"
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </label>
            </div>

            {/* الفعاليات */}
            {events.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-600">الفعاليات اللي يقدر يسجّل فيها حضور</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {events.map((ev) => (
                    <label key={ev.id} className="flex cursor-pointer items-center gap-2 rounded-xl bg-white p-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded accent-indigo-700"
                        checked={selectedEvts.has(ev.id)}
                        onChange={() => toggleEvt(ev.id, setSelectedEvts)}
                      />
                      <span className="font-semibold text-slate-700">{ev.name}</span>
                      {!ev.is_active && (
                        <span className="text-xs text-slate-400">(موقوفة)</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <button
              disabled={busy}
              className="w-full rounded-xl bg-indigo-700 py-2 font-bold text-white disabled:opacity-50"
            >
              {busy ? '...' : 'إنشاء الحساب'}
            </button>
          </form>
        )}
      </section>

      {/* ——— قايمة الخدام ——— */}
      {servants.length === 0 && (
        <p className="text-center text-slate-500">مفيش خدام لسه — ابدأ بإضافة خادم.</p>
      )}

      {servants.map((s) => {
        const assignedIds = new Set(s.staff_events.map((se) => se.event_id));
        const assignedNames = events
          .filter((ev) => assignedIds.has(ev.id))
          .map((ev) => ev.name);

        return (
          <section
            key={s.id}
            className={`rounded-2xl bg-white p-5 shadow space-y-3 border-r-4 ${
              s.is_active ? 'border-indigo-400' : 'border-slate-300'
            }`}
          >
            {/* هيدر الخادم */}
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-extrabold text-slate-800">{s.display_name}</h3>
                <p className="text-sm text-slate-500">
                  اسم الدخول:{' '}
                  <span className="font-mono text-slate-700">{s.login_name}</span>
                  {' · '}
                  <span className={s.is_active ? 'font-semibold text-indigo-600' : 'text-slate-400'}>
                    {s.is_active ? '🟢 نشط' : '⚪ موقوف'}
                  </span>
                </p>

                {/* الفعاليات المسندة */}
                <div className="mt-1 flex flex-wrap gap-1">
                  {assignedNames.length === 0 ? (
                    <span className="text-xs text-slate-400">مش مسند له فعاليات</span>
                  ) : (
                    assignedNames.map((n) => (
                      <span key={n} className="rounded-lg bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                        {n}
                      </span>
                    ))
                  )}
                </div>
              </div>

              {/* أزرار */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => expandedId === s.id ? setExpandedId(null) : openEdit(s)}
                  className="rounded-xl bg-slate-100 px-3 py-1.5 text-sm font-bold text-slate-700"
                >
                  {expandedId === s.id ? 'إغلاق' : 'الفعاليات'}
                </button>

                <button
                  onClick={() => toggleActive(s)}
                  disabled={busy}
                  className={`rounded-xl px-3 py-1.5 text-sm font-bold disabled:opacity-50 ${
                    s.is_active ? 'bg-slate-200 text-slate-700' : 'bg-indigo-600 text-white'
                  }`}
                >
                  {s.is_active ? 'إيقاف' : 'تفعيل'}
                </button>

                {confirmDeleteId === s.id ? (
                  <>
                    <button
                      onClick={() => deleteServant(s)}
                      disabled={busy}
                      className="rounded-xl bg-red-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
                    >
                      تأكيد الحذف
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded-xl bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-600"
                    >
                      إلغاء
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(s.id)}
                    className="rounded-xl bg-red-50 px-3 py-1.5 text-sm font-bold text-red-600"
                  >
                    حذف
                  </button>
                )}
              </div>
            </div>

            {/* ——— تعديل الفعاليات (قابل للطي) ——— */}
            {expandedId === s.id && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <p className="text-sm font-semibold text-slate-600">الفعاليات اللي يقدر يسجّل فيها:</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {events.map((ev) => (
                    <label key={ev.id} className="flex cursor-pointer items-center gap-2 rounded-xl bg-white p-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded accent-indigo-700"
                        checked={editEvts.has(ev.id)}
                        onChange={() => toggleEvt(ev.id, setEditEvts)}
                      />
                      <span className="font-semibold text-slate-700">{ev.name}</span>
                      {!ev.is_active && (
                        <span className="text-xs text-slate-400">(موقوفة)</span>
                      )}
                    </label>
                  ))}
                </div>
                <button
                  onClick={() => saveEventAssignments(s)}
                  disabled={busy}
                  className="rounded-xl bg-indigo-700 px-4 py-2 font-bold text-white disabled:opacity-50"
                >
                  {busy ? '...' : 'حفظ'}
                </button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
