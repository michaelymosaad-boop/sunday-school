import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// الفعالية: اسم + وقت بداية + مراحل نقاط (tiers)
// كل فعالية ممكن تتفعّل أو تتوقف — الخادم بيشوف الفعاليات النشطة بس

const DEFAULT_TIERS = [
  { position: 1, label: 'في الموعد', up_to_minutes: 15,   points: 10 },
  { position: 2, label: 'متأخر شوية', up_to_minutes: 30,  points: 7  },
  { position: 3, label: 'متأخر',      up_to_minutes: null, points: 5  },
];

export default function AdminEvents() {
  const [events, setEvents]   = useState([]);
  const [msg, setMsg]         = useState('');
  const [err, setErr]         = useState('');
  const [busy, setBusy]       = useState(false);
  const [openId, setOpenId]   = useState(null); // الفعالية المفتوحة للتعديل

  // فورم الإضافة
  const [newName, setNewName]       = useState('');
  const [newTime, setNewTime]       = useState('09:00');
  const [newEnd, setNewEnd]         = useState('11:00');
  const [newTiers, setNewTiers]     = useState(DEFAULT_TIERS);
  const [showForm, setShowForm]     = useState(false);

  async function load() {
    const { data, error } = await supabase
      .from('events')
      .select('id,name,start_time,end_time,is_active,event_tiers(id,position,up_to_minutes,points)')
      .order('id', { ascending: false });
    if (error) throw error;
    // رتّب الـ tiers داخل كل فعالية
    setEvents(
      data.map((ev) => ({
        ...ev,
        event_tiers: [...(ev.event_tiers ?? [])].sort((a, b) => a.position - b.position),
      }))
    );
  }

  useEffect(() => { load().catch((e) => setErr(e.message)); }, []);

  async function run(fn) {
    setBusy(true); setErr(''); setMsg('');
    try { await fn(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  // ——— إضافة فعالية جديدة ———
  async function addEvent(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return setErr('اكتب اسم الفعالية');
    if (newEnd <= newTime) return setErr('وقت النهاية لازم يكون بعد وقت البداية');
    if (newTiers.some((t) => t.points < 0)) return setErr('النقاط لازم تكون صفر أو أكتر');

    run(async () => {
      // 1) اضف الفعالية
      const { data: ev, error: evErr } = await supabase
        .from('events')
        .insert({ name, start_time: newTime, end_time: newEnd })
        .select('id')
        .single();
      if (evErr) throw evErr;

      // 2) اضف الـ tiers
      const tiers = newTiers.map((t) => ({
        event_id:       ev.id,
        position:       t.position,
        up_to_minutes:  t.up_to_minutes,
        points:         Number(t.points),
      }));
      const { error: tierErr } = await supabase.from('event_tiers').insert(tiers);
      if (tierErr) throw tierErr;

      setMsg(`تم إضافة فعالية "${name}"`);
      setNewName(''); setNewTime('09:00'); setNewEnd('11:00'); setNewTiers(DEFAULT_TIERS);
      setShowForm(false);
      await load();
    });
  }

  // ——— تفعيل / إيقاف ———
  function toggleActive(ev) {
    run(async () => {
      const { error } = await supabase
        .from('events')
        .update({ is_active: !ev.is_active })
        .eq('id', ev.id);
      if (error) throw error;
      setMsg(ev.is_active ? `تم إيقاف "${ev.name}"` : `تم تفعيل "${ev.name}"`);
      await load();
    });
  }

  // ——— تعديل وقت النهاية ———
  function saveEnd(ev, value) {
    if (value && value <= ev.start_time.slice(0, 5)) return setErr('وقت النهاية لازم يكون بعد وقت البداية');
    run(async () => {
      const { error } = await supabase.from('events').update({ end_time: value || null }).eq('id', ev.id);
      if (error) throw error;
      setMsg(`تم تعديل وقت نهاية "${ev.name}"`);
      await load();
    });
  }

  // ——— حذف فعالية ———
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  function deleteEvent(ev) {
    run(async () => {
      const { error } = await supabase.from('events').delete().eq('id', ev.id);
      if (error) throw error;
      setConfirmDeleteId(null);
      setMsg(`تم حذف "${ev.name}"`);
      await load();
    });
  }

  return (
    <div className="space-y-6">
      {msg && <p className="rounded-xl bg-emerald-50 p-3 font-semibold text-emerald-700">{msg}</p>}
      {err && <p className="rounded-xl bg-red-50 p-3 font-semibold text-red-600">{err}</p>}

      {/* ——— زرار / فورم إضافة ——— */}
      <section className="rounded-2xl bg-white p-5 shadow space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-indigo-900">الفعاليات ({events.length})</h2>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-xl bg-indigo-700 px-4 py-2 font-bold text-white"
          >
            {showForm ? 'إلغاء' : '+ فعالية جديدة'}
          </button>
        </div>

        {showForm && (
          <form onSubmit={addEvent} className="space-y-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
            <h3 className="font-bold text-indigo-800">فعالية جديدة</h3>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-sm font-semibold text-slate-600">اسم الفعالية</span>
                <input
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  placeholder="مثال: قداس الأحد"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  required
                />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-semibold text-slate-600">وقت البداية</span>
                <input
                  type="time"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                  required
                />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-semibold text-slate-600">وقت النهاية (بعده مفيش تسجيل)</span>
                <input
                  type="time"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  value={newEnd}
                  onChange={(e) => setNewEnd(e.target.value)}
                  required
                />
              </label>
            </div>

            {/* مراحل النقاط */}
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-600">مراحل النقاط</p>
              {newTiers.map((tier, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-xl bg-white p-3">
                  <span className="font-semibold text-slate-700">{tier.label}</span>
                  <label className="flex items-center gap-1 text-sm text-slate-600">
                    حتى
                    <input
                      type="number"
                      min="1"
                      className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-center"
                      value={tier.up_to_minutes ?? ''}
                      disabled={tier.up_to_minutes === null}
                      onChange={(e) => {
                        const next = [...newTiers];
                        next[i] = { ...next[i], up_to_minutes: e.target.value ? Number(e.target.value) : null };
                        setNewTiers(next);
                      }}
                      placeholder="∞"
                    />
                    دقيقة
                  </label>
                  <label className="flex items-center gap-1 text-sm text-slate-600">
                    <input
                      type="number"
                      min="0"
                      className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-center"
                      value={tier.points}
                      onChange={(e) => {
                        const next = [...newTiers];
                        next[i] = { ...next[i], points: Number(e.target.value) };
                        setNewTiers(next);
                      }}
                    />
                    نقطة
                  </label>
                </div>
              ))}
              <p className="text-xs text-slate-400">المرحلة الأخيرة "متأخر" مفتوحة (بعد الحد الأقصى للتانية)</p>
            </div>

            <button
              disabled={busy}
              className="w-full rounded-xl bg-indigo-700 py-2 font-bold text-white disabled:opacity-50"
            >
              {busy ? '...' : 'إضافة الفعالية'}
            </button>
          </form>
        )}
      </section>

      {/* ——— قائمة الفعاليات ——— */}
      {events.length === 0 && (
        <p className="text-center text-slate-500">مفيش فعاليات لسه — ابدأ بإضافة فعالية.</p>
      )}

      {events.map((ev) => (
        <section
          key={ev.id}
          className={`rounded-2xl bg-white p-5 shadow space-y-3 border-r-4 ${
            ev.is_active ? 'border-emerald-500' : 'border-slate-300'
          }`}
        >
          {/* هيدر الفعالية */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-extrabold text-slate-800">{ev.name}</h3>
              <p className="text-sm text-slate-500">
                وقت البداية: <span className="font-mono">{ev.start_time?.slice(0, 5)}</span>
                {' · '}
                النهاية: <EndTime ev={ev} busy={busy} onSave={saveEnd} />
                {' · '}
                <span className={ev.is_active ? 'text-emerald-600 font-semibold' : 'text-slate-400'}>
                  {ev.is_active ? '🟢 نشطة' : '⚪ موقوفة'}
                </span>
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => toggleActive(ev)}
                disabled={busy}
                className={`rounded-xl px-3 py-1.5 text-sm font-bold disabled:opacity-50 ${
                  ev.is_active
                    ? 'bg-slate-200 text-slate-700'
                    : 'bg-emerald-600 text-white'
                }`}
              >
                {ev.is_active ? 'إيقاف' : 'تفعيل'}
              </button>

              {confirmDeleteId === ev.id ? (
                <>
                  <button
                    onClick={() => deleteEvent(ev)}
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
                  onClick={() => setConfirmDeleteId(ev.id)}
                  className="rounded-xl bg-red-50 px-3 py-1.5 text-sm font-bold text-red-600"
                >
                  حذف
                </button>
              )}
            </div>
          </div>

          {/* مراحل النقاط */}
          {ev.event_tiers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {ev.event_tiers.map((t) => (
                <div
                  key={t.id}
                  className="rounded-xl bg-slate-50 px-3 py-2 text-sm"
                >
                  <span className="font-bold text-indigo-700">{t.points} نقطة</span>
                  <span className="mx-1 text-slate-400">·</span>
                  <span className="text-slate-600">
                    {t.up_to_minutes != null ? `حتى ${t.up_to_minutes} دقيقة` : 'لحد نهاية الفعالية'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

// وقت النهاية: بيتعدّل من هنا، وفاضي = مفيش حد أقصى
function EndTime({ ev, busy, onSave }) {
  const current = ev.end_time?.slice(0, 5) ?? '';
  const [val, setVal] = useState(current);
  useEffect(() => setVal(current), [current]);
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="time"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="rounded-lg border border-slate-300 px-1 py-0.5 font-mono text-sm"
      />
      {val !== current && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onSave(ev, val)}
          className="rounded-lg bg-indigo-700 px-2 py-0.5 text-xs font-bold text-white"
        >
          حفظ
        </button>
      )}
      {!current && <span className="text-xs text-amber-600">(من غير حد أقصى)</span>}
    </span>
  );
}
