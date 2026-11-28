import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// الفعالية = اسم + جدول (أسبوعي / مرة واحدة / تواريخ محددة) + وقت + مراحل نقط.
// الإعدادات بتتخزن في "نسخ" كل نسخة سارية من تاريخ معين،
// فتعديل الفعالية بيأثر على الأيام الجاية بس، واللي اتسجل قبل كده بيفضل زي ما هو.

const DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5]; // الأسبوع عندنا بيبدأ بالسبت
const TIER_LABELS = ['في الموعد', 'متأخر شوية', 'متأخر'];

const DEFAULT_TIERS = [
  { position: 1, up_to_minutes: 15, points: 10 },
  { position: 2, up_to_minutes: 30, points: 7 },
  { position: 3, up_to_minutes: null, points: 5 },
];

const todayCairo = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
const dowOf = (dateStr) => new Date(`${dateStr}T12:00:00`).getDay();
const fmtDate = (d) =>
  new Date(`${d}T12:00:00`).toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'short' });

// النسخة السارية دلوقتي + أول نسخة جاية (لو فيه)
function pickVersions(versions, today) {
  const sorted = [...(versions ?? [])].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const past = sorted.filter((v) => v.effective_from <= today);
  return { current: past.length ? past[past.length - 1] : sorted[0], next: sorted.find((v) => v.effective_from > today) };
}

function occursOn(v, dateStr) {
  if (!v) return false;
  if (v.kind === 'weekly') return v.weekdays.includes(dowOf(dateStr));
  return v.dates.includes(dateStr);
}

function describeSchedule(v) {
  if (!v) return '';
  if (v.kind === 'weekly') {
    const days = WEEK_ORDER.filter((d) => v.weekdays.includes(d)).map((d) => DAY_NAMES[d]);
    if (days.length === 7) return 'كل يوم';
    return days.length ? `كل ${days.join(' و')}` : 'من غير أيام';
  }
  if (v.kind === 'once') return v.dates[0] ? `مرة واحدة — ${fmtDate(v.dates[0])}` : 'مرة واحدة';
  return `${v.dates.length} تواريخ محددة`;
}

export default function AdminEvents() {
  const [events, setEvents] = useState([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  async function load() {
    const { data, error } = await supabase
      .from('events')
      .select('id,name,is_active,event_versions(*)')
      .order('id', { ascending: false });
    if (error) throw error;
    setEvents(data);
  }

  useEffect(() => { load().catch((e) => setErr(e.message)); }, []);

  async function run(fn) {
    setBusy(true); setErr(''); setMsg('');
    try { await fn(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  function versionRow(f) {
    return {
      kind: f.kind,
      weekdays: f.kind === 'weekly' ? f.weekdays : [],
      dates: f.kind === 'weekly' ? [] : f.dates,
      start_time: f.start,
      end_time: f.end || null,
      tiers: f.tiers.map((t) => ({
        position: t.position,
        up_to_minutes: t.up_to_minutes === null || t.up_to_minutes === '' ? null : Number(t.up_to_minutes),
        points: Number(t.points),
      })),
    };
  }

  // ——— إضافة فعالية ———
  function addEvent(f) {
    run(async () => {
      const { data: ev, error } = await supabase
        .from('events')
        .insert({ name: f.name, start_time: f.start, end_time: f.end || null })
        .select('id')
        .single();
      if (error) throw error;
      const { error: vErr } = await supabase
        .from('event_versions')
        .insert({ event_id: ev.id, effective_from: todayCairo(), ...versionRow(f) });
      if (vErr) {
        await supabase.from('events').delete().eq('id', ev.id); // نرجّع زي ما كان لو النسخة فشلت
        throw vErr;
      }
      setMsg(`تم إضافة فعالية "${f.name}"`);
      setShowForm(false);
      await load();
    });
  }

  // ——— تعديل فعالية: نسخة جديدة سارية من تاريخ معين ———
  function saveEdit(ev, f) {
    run(async () => {
      const { error: nErr } = await supabase.from('events').update({ name: f.name }).eq('id', ev.id);
      if (nErr) throw nErr;

      const existing = (ev.event_versions ?? []).find((v) => v.effective_from === f.from);
      const row = versionRow(f);
      const { error } = existing
        ? await supabase.from('event_versions').update(row).eq('id', existing.id)
        : await supabase.from('event_versions').insert({ event_id: ev.id, effective_from: f.from, ...row });
      if (error) throw error;

      setMsg(`تم تعديل "${f.name}" من ${fmtDate(f.from)}`);
      setEditingId(null);
      await load();
    });
  }

  function toggleActive(ev) {
    run(async () => {
      const { error } = await supabase.from('events').update({ is_active: !ev.is_active }).eq('id', ev.id);
      if (error) throw error;
      setMsg(ev.is_active ? `تم إيقاف "${ev.name}"` : `تم تفعيل "${ev.name}"`);
      await load();
    });
  }

  function deleteEvent(ev) {
    run(async () => {
      const { error } = await supabase.from('events').delete().eq('id', ev.id);
      if (error) throw error;
      setConfirmDeleteId(null);
      setMsg(`تم حذف "${ev.name}"`);
      await load();
    });
  }

  const today = todayCairo();

  return (
    <div className="space-y-6">
      {msg && <p className="rounded-xl bg-emerald-50 p-3 font-semibold text-emerald-700">{msg}</p>}
      {err && <p className="rounded-xl bg-red-50 p-3 font-semibold text-red-600">{err}</p>}

      <section className="space-y-4 rounded-2xl bg-white p-5 shadow">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-indigo-900">الفعاليات ({events.length})</h2>
          <button
            onClick={() => { setShowForm((v) => !v); setEditingId(null); }}
            className="rounded-xl bg-indigo-700 px-4 py-2 font-bold text-white"
          >
            {showForm ? 'إلغاء' : '+ فعالية جديدة'}
          </button>
        </div>

        {showForm && (
          <EventForm
            title="فعالية جديدة"
            submitLabel="إضافة الفعالية"
            busy={busy}
            onSubmit={addEvent}
            initial={{
              name: '', kind: 'weekly', weekdays: [5], dates: [], start: '09:00', end: '11:00', tiers: DEFAULT_TIERS,
            }}
          />
        )}
      </section>

      {events.length === 0 && (
        <p className="text-center text-slate-500">مفيش فعاليات لسه — ابدأ بإضافة فعالية.</p>
      )}

      {events.map((ev) => {
        const { current, next } = pickVersions(ev.event_versions, today);
        const runsToday = ev.is_active && occursOn(current, today) && current.effective_from <= today;

        return (
          <section
            key={ev.id}
            className={`space-y-3 rounded-2xl border-r-4 bg-white p-5 shadow ${
              ev.is_active ? 'border-emerald-500' : 'border-slate-300'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1">
                <h3 className="flex flex-wrap items-center gap-2 font-extrabold text-slate-800">
                  {ev.name}
                  {runsToday && (
                    <span className="rounded-lg bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">النهارده</span>
                  )}
                </h3>
                <p className="text-sm text-slate-600">
                  <span className="font-semibold">{describeSchedule(current)}</span>
                  {' · '}
                  <span className="font-mono">
                    {current?.start_time?.slice(0, 5)}
                    {current?.end_time ? ` → ${current.end_time.slice(0, 5)}` : ' (من غير نهاية)'}
                  </span>
                  {' · '}
                  <span className={ev.is_active ? 'font-semibold text-emerald-600' : 'text-slate-400'}>
                    {ev.is_active ? '🟢 نشطة' : '⚪ موقوفة'}
                  </span>
                </p>
                {next && (
                  <p className="text-xs font-semibold text-amber-700">
                    من {fmtDate(next.effective_from)}: {describeSchedule(next)} · {next.start_time.slice(0, 5)}
                    {next.end_time ? ` → ${next.end_time.slice(0, 5)}` : ''}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => { setEditingId(editingId === ev.id ? null : ev.id); setShowForm(false); }}
                  className="rounded-xl bg-indigo-50 px-3 py-1.5 text-sm font-bold text-indigo-700"
                >
                  {editingId === ev.id ? 'إغلاق' : 'تعديل'}
                </button>
                <button
                  onClick={() => toggleActive(ev)}
                  disabled={busy}
                  className={`rounded-xl px-3 py-1.5 text-sm font-bold disabled:opacity-50 ${
                    ev.is_active ? 'bg-slate-200 text-slate-700' : 'bg-emerald-600 text-white'
                  }`}
                >
                  {ev.is_active ? 'إيقاف' : 'تفعيل'}
                </button>
                {confirmDeleteId === ev.id ? (
                  <>
                    <button onClick={() => deleteEvent(ev)} disabled={busy} className="rounded-xl bg-red-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">
                      تأكيد الحذف
                    </button>
                    <button onClick={() => setConfirmDeleteId(null)} className="rounded-xl bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-600">
                      إلغاء
                    </button>
                  </>
                ) : (
                  <button onClick={() => setConfirmDeleteId(ev.id)} className="rounded-xl bg-red-50 px-3 py-1.5 text-sm font-bold text-red-600">
                    حذف
                  </button>
                )}
              </div>
            </div>

            {current?.tiers?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {[...current.tiers].sort((a, b) => a.position - b.position).map((t) => (
                  <div key={t.position} className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
                    <span className="font-bold text-indigo-700">{t.points} نقطة</span>
                    <span className="mx-1 text-slate-400">·</span>
                    <span className="text-slate-600">
                      {t.up_to_minutes != null ? `حتى ${t.up_to_minutes} دقيقة` : 'لحد نهاية الفعالية'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {editingId === ev.id && current && (
              <EventForm
                title="تعديل الفعالية"
                submitLabel="حفظ التعديل"
                busy={busy}
                editing
                onSubmit={(f) => saveEdit(ev, f)}
                initial={{
                  name: ev.name,
                  kind: current.kind,
                  weekdays: current.weekdays,
                  dates: current.dates,
                  start: current.start_time.slice(0, 5),
                  end: current.end_time?.slice(0, 5) ?? '',
                  tiers: current.tiers.length ? current.tiers : DEFAULT_TIERS,
                }}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}

/* ——— فورم الإضافة / التعديل ——— */
function EventForm({ title, submitLabel, initial, busy, editing, onSubmit }) {
  const [name, setName] = useState(initial.name);
  const [kind, setKind] = useState(initial.kind);
  const [weekdays, setWeekdays] = useState(initial.weekdays);
  const [dates, setDates] = useState(initial.dates);
  const [dateInput, setDateInput] = useState('');
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [tiers, setTiers] = useState(
    [...initial.tiers].sort((a, b) => a.position - b.position).map((t) => ({ ...t }))
  );
  const [from, setFrom] = useState(todayCairo());
  const [localErr, setLocalErr] = useState('');

  function toggleDay(d) {
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  function addDate() {
    if (!dateInput) return;
    setDates((prev) => (prev.includes(dateInput) ? prev : [...prev, dateInput].sort()));
    setDateInput('');
  }

  function submit(e) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setLocalErr('اكتب اسم الفعالية');
    if (kind === 'weekly' && weekdays.length === 0) return setLocalErr('اختار يوم واحد على الأقل');
    if (kind === 'once' && dates.length !== 1) return setLocalErr('اختار تاريخ الفعالية');
    if (kind === 'dates' && dates.length === 0) return setLocalErr('أضف تاريخ واحد على الأقل');
    if (end && end <= start) return setLocalErr('وقت النهاية لازم يكون بعد وقت البداية');
    if (tiers.some((t) => Number(t.points) < 0)) return setLocalErr('النقط لازم تكون صفر أو أكتر');
    setLocalErr('');
    onSubmit({ name: n, kind, weekdays, dates, start, end, tiers, from });
  }

  const chip = (on) =>
    `rounded-xl px-3 py-1.5 text-sm font-bold ${on ? 'bg-indigo-700 text-white' : 'bg-white text-slate-600 shadow-sm'}`;

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
      <h3 className="font-bold text-indigo-800">{title}</h3>

      <label className="block space-y-1">
        <span className="text-sm font-semibold text-slate-600">اسم الفعالية</span>
        <input
          className="w-full rounded-xl border border-slate-300 px-3 py-2"
          placeholder="مثال: قداس الجمعة"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>

      {/* نوع الفعالية */}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-slate-600">بتتكرر إزاي؟</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={chip(kind === 'weekly')} onClick={() => setKind('weekly')}>أسبوعي</button>
          <button type="button" className={chip(kind === 'once')} onClick={() => { setKind('once'); setDates((d) => d.slice(0, 1)); }}>مرة واحدة</button>
          <button type="button" className={chip(kind === 'dates')} onClick={() => setKind('dates')}>تواريخ محددة</button>
        </div>

        {kind === 'weekly' && (
          <div className="flex flex-wrap gap-2">
            {WEEK_ORDER.map((d) => (
              <button key={d} type="button" className={chip(weekdays.includes(d))} onClick={() => toggleDay(d)}>
                {DAY_NAMES[d]}
              </button>
            ))}
          </div>
        )}

        {kind === 'once' && (
          <input
            type="date"
            className="rounded-xl border border-slate-300 px-3 py-2"
            value={dates[0] ?? ''}
            onChange={(e) => setDates(e.target.value ? [e.target.value] : [])}
          />
        )}

        {kind === 'dates' && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="date"
                className="rounded-xl border border-slate-300 px-3 py-2"
                value={dateInput}
                onChange={(e) => setDateInput(e.target.value)}
              />
              <button type="button" onClick={addDate} className="rounded-xl bg-indigo-700 px-4 py-2 font-bold text-white">
                إضافة
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {dates.length === 0 && <span className="text-xs text-slate-400">لسه مفيش تواريخ</span>}
              {dates.map((d) => (
                <span key={d} className="flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-sm shadow-sm">
                  {fmtDate(d)}
                  <button type="button" onClick={() => setDates((prev) => prev.filter((x) => x !== d))} className="font-bold text-red-500">
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-slate-600">وقت البداية</span>
          <input type="time" className="w-full rounded-xl border border-slate-300 px-3 py-2" value={start} onChange={(e) => setStart(e.target.value)} required />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-slate-600">وقت النهاية (بعده مفيش تسجيل)</span>
          <input type="time" className="w-full rounded-xl border border-slate-300 px-3 py-2" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>

      {/* مراحل النقط */}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-slate-600">مراحل النقط</p>
        {tiers.map((tier, i) => (
          <div key={tier.position} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-xl bg-white p-3">
            <span className="font-semibold text-slate-700">{TIER_LABELS[i] ?? `مرحلة ${i + 1}`}</span>
            <label className="flex items-center gap-1 text-sm text-slate-600">
              حتى
              <input
                type="number"
                min="0"
                className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-center disabled:bg-slate-100"
                value={tier.up_to_minutes ?? ''}
                disabled={tier.up_to_minutes === null}
                placeholder="∞"
                onChange={(e) => {
                  const next = [...tiers];
                  next[i] = { ...next[i], up_to_minutes: e.target.value === '' ? null : Number(e.target.value) };
                  setTiers(next);
                }}
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
                  const next = [...tiers];
                  next[i] = { ...next[i], points: e.target.value === '' ? 0 : Number(e.target.value) };
                  setTiers(next);
                }}
              />
              نقطة
            </label>
          </div>
        ))}
        <p className="text-xs text-slate-400">المرحلة الأخيرة مفتوحة: بتاخد نقطها من بعد المرحلة اللي قبلها لحد نهاية الفعالية.</p>
      </div>

      {editing && (
        <label className="block space-y-1 rounded-xl bg-amber-50 p-3">
          <span className="text-sm font-bold text-amber-800">طبّق التعديل من تاريخ</span>
          <input
            type="date"
            className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            required
          />
          <span className="block text-xs text-amber-700">
            التعديل بيأثر من التاريخ ده وبعده بس. اللي اتسجل قبله ونقطه مبيتغيّروش.
          </span>
        </label>
      )}

      {localErr && <p className="text-sm font-semibold text-red-600">{localErr}</p>}

      <button disabled={busy} className="w-full rounded-xl bg-indigo-700 py-2 font-bold text-white disabled:opacity-50">
        {busy ? '...' : submitLabel}
      </button>
    </form>
  );
}
