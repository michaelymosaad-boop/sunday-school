import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

export default function ServantHome({ profile }) {
  const [tab, setTab] = useState('scan');

  return (
    <div className="mx-auto max-w-md space-y-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold text-indigo-900">أهلاً {profile.display_name}</h1>
        <button
          onClick={() => supabase.auth.signOut()}
          className="rounded-xl bg-slate-200 px-4 py-2 font-semibold text-slate-700"
        >
          خروج
        </button>
      </header>

      <nav className="flex gap-2">
        <Tab active={tab === 'scan'} onClick={() => setTab('scan')}>تسجيل الحضور</Tab>
      </nav>

      {tab === 'scan' && <AttendanceTab />}
    </div>
  );
}

/* ——— تاب تسجيل الحضور ——— */
function AttendanceTab() {
  const [classes,  setClasses]  = useState([]);
  const [kids,     setKids]     = useState([]);
  const [events,   setEvents]   = useState([]);

  const [selClass,  setSelClass]  = useState('');
  const [selKid,    setSelKid]    = useState('');
  const [selEvent,  setSelEvent]  = useState('');

  const [msg,     setMsg]     = useState('');
  const [err,     setErr]     = useState('');
  const [loading, setLoading] = useState(false);

  /* جلب الفصول والفعاليات مرة واحدة */
  useEffect(() => {
    supabase.from('classes').select('id,name').order('name')
      .then(({ data }) => setClasses(data ?? []));

    supabase.from('events')
      .select('id,name,service_date')
      .eq('is_active', true)
      .order('service_date', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setEvents(data ?? []);
        if (data && data.length > 0) setSelEvent(String(data[0].id));
      });
  }, []);

  /* لما يتغير الفصل: جيب مخدوميه */
  useEffect(() => {
    if (!selClass) { setKids([]); setSelKid(''); return; }
    supabase.from('kids')
      .select('id,full_name,card_code,short_code')
      .eq('class_id', selClass)
      .eq('is_active', true)
      .order('full_name')
      .then(({ data }) => { setKids(data ?? []); setSelKid(''); });
  }, [selClass]);

  async function recordAttendance() {
    if (!selKid)   return setErr('اختار المخدوم');
    if (!selEvent) return setErr('اختار الفعالية');
    setErr(''); setLoading(true);

    try {
      const kid = kids.find((k) => String(k.id) === selKid);
      // record_scan بتاخد card_code — لو ما عنده card_code خاص نستخدم short_code
      const code = kid?.card_code || kid?.short_code;
      if (!code) throw new Error('المخدوم ده مالوش كود — اتصل بالأدمن');

      const { data, error } = await supabase.rpc('record_scan', {
        p_card_code: code,
        p_event_id:  Number(selEvent),
      });
      if (error) throw error;

      if (data?.type === 'duplicate') {
        setErr(`"${kid.full_name}" اتسجل حضوره قبل كده`);
      } else if (data?.type === 'unknown') {
        setErr('مش لاقي المخدوم في الداتابيز — اتصل بالأدمن');
      } else {
        setMsg(`✅ تم تسجيل حضور "${kid.full_name}"${data?.points ? ` — ${data.points} نقطة` : ''}`);
        setSelKid('');
        setTimeout(() => setMsg(''), 4000);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl bg-white p-5 shadow">
      <h2 className="font-bold text-slate-700">تسجيل الحضور من القائمة</h2>

      {/* الفعالية */}
      <label className="block space-y-1">
        <span className="text-sm font-semibold text-slate-600">الفعالية</span>
        <select
          className="w-full rounded-xl border border-slate-300 px-3 py-2"
          value={selEvent}
          onChange={(e) => setSelEvent(e.target.value)}
        >
          <option value="">— اختار الفعالية —</option>
          {events.map((ev) => (
            <option key={ev.id} value={String(ev.id)}>
              {ev.name} — {ev.service_date}
            </option>
          ))}
        </select>
      </label>

      {/* الفصل */}
      <label className="block space-y-1">
        <span className="text-sm font-semibold text-slate-600">الفصل / المرحلة</span>
        <select
          className="w-full rounded-xl border border-slate-300 px-3 py-2"
          value={selClass}
          onChange={(e) => setSelClass(e.target.value)}
        >
          <option value="">— اختار الفصل —</option>
          {classes.map((c) => (
            <option key={c.id} value={String(c.id)}>{c.name}</option>
          ))}
        </select>
      </label>

      {/* المخدوم */}
      <label className="block space-y-1">
        <span className="text-sm font-semibold text-slate-600">المخدوم</span>
        <select
          className="w-full rounded-xl border border-slate-300 px-3 py-2"
          value={selKid}
          onChange={(e) => setSelKid(e.target.value)}
          disabled={!selClass}
        >
          <option value="">{selClass ? '— اختار المخدوم —' : '— اختار الفصل الأول —'}</option>
          {kids.map((k) => (
            <option key={k.id} value={String(k.id)}>{k.full_name}</option>
          ))}
        </select>
      </label>

      {err && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-600">{err}</p>}
      {msg && <p className="rounded-xl bg-green-50 p-3 text-sm font-semibold text-green-700">{msg}</p>}

      <button
        onClick={recordAttendance}
        disabled={loading || !selKid || !selEvent}
        className="w-full rounded-xl bg-indigo-700 py-3 font-bold text-white disabled:opacity-40"
      >
        {loading ? '...' : '✓ تسجيل الحضور'}
      </button>
    </div>
  );
}

function Tab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl px-4 py-2 font-bold ${
        active ? 'bg-indigo-700 text-white' : 'bg-white text-slate-700 shadow'
      }`}
    >
      {children}
    </button>
  );
}
