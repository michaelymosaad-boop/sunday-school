import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// مكتبة قراءة QR تقيلة، بنأجل تحميلها لحد ما الخادم يفتح الكاميرا
const QrScanner = lazy(() => import('../components/QrScanner.jsx'));

export default function ServantHome({ profile }) {
  const [tab, setTab] = useState('camera');
  const [events, setEvents] = useState(null); // null = لسه بيحمّل
  const [selEvent, setSelEvent] = useState('');

  const [loadErr, setLoadErr] = useState('');

  // فعاليات النهارده المسموحة: السيرفر بيحدد حسب الجدول والصلاحية (الأدمن يشوف كل فعاليات النهارده)
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('my_events_today');
      if (error) setLoadErr(error.message);
      const list = error ? [] : data ?? [];
      setEvents(list);
      if (list.length) setSelEvent(String(list[0].id));
    })();
  }, []);

  const event = events?.find((e) => String(e.id) === selEvent);
  const ended = isEnded(event);

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

      {events === null && <p className="text-center text-slate-500">جاري التحميل...</p>}

      {events?.length === 0 && (
        <p className="rounded-2xl bg-amber-50 p-4 text-center font-semibold text-amber-800">
          {loadErr ? `حصلت مشكلة: ${loadErr}` : 'مفيش فعاليات ليك النهارده.'}
        </p>
      )}

      {events?.length > 0 && (
        <>
          <label className="block space-y-1">
            <span className="text-sm font-semibold text-slate-600">الفعالية</span>
            <select
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
              value={selEvent}
              onChange={(e) => setSelEvent(e.target.value)}
            >
              {events.map((ev) => (
                <option key={ev.id} value={String(ev.id)}>
                  {ev.name} — {ev.start_time?.slice(0, 5)}{ev.end_time ? ` إلى ${ev.end_time.slice(0, 5)}` : ''}
                </option>
              ))}
            </select>
          </label>

          <nav className="flex gap-2">
            <Tab active={tab === 'camera'} onClick={() => setTab('camera')}>📷 مسح بالكاميرا</Tab>
            <Tab active={tab === 'list'} onClick={() => setTab('list')}>بحث بالاسم</Tab>
            <Tab active={tab === 'summary'} onClick={() => setTab('summary')}>ملخص</Tab>
          </nav>

          {ended && tab !== 'summary' && (
            <p className="rounded-2xl bg-red-50 p-4 text-center font-bold text-red-600">
              الفعالية خلصت الساعة {event.end_time.slice(0, 5)} — مينفعش تسجيل حضور دلوقتي.
            </p>
          )}

          {tab === 'camera' && !ended && <CameraTab eventId={selEvent} />}
          {tab === 'list' && !ended && <ListTab eventId={selEvent} />}
          {tab === 'summary' && <SummaryTab event={event} profile={profile} ended={ended} />}
        </>
      )}
    </div>
  );
}

const cairoDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
const cairoTime = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Cairo', hour12: false }).slice(0, 5);
const isEnded = (ev) => !!ev?.end_time && cairoTime() > ev.end_time.slice(0, 5);

// بيحوّل نتيجة الـ record_scan لرسالة للخادم
function describe(data, fallbackName) {
  const name = data?.kid || fallbackName || '';
  if (data?.type === 'not_today') return { ok: false, text: 'الفعالية دي مش النهارده' };
  if (data?.type === 'closed') return { ok: false, text: 'الفعالية خلصت — مينفعش تسجيل' };
  if (data?.type === 'duplicate') return { ok: false, text: `"${name}" اتسجل حضوره قبل كده` };
  if (data?.type === 'unknown') return { ok: false, text: 'الكارت ده مش معروف' };
  return { ok: true, text: `✅ ${name} — ${data?.points ?? 0} نقطة` };
}

function friendlyError(e) {
  const m = e?.message ?? '';
  if (m.includes('event not allowed')) return 'الفعالية دي مش مسموحة ليك';
  if (m.includes('not your scan')) return 'ده مش تسجيلك';
  if (m.includes('event not found')) return 'الفعالية موقوفة';
  return m || 'حصلت مشكلة';
}

/* ——— مسح بالكاميرا (متواصل) ——— */
function CameraTab({ eventId }) {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0); // بنغيّره عشان الكاميرا تفتح من جديد بعد كل مسح
  const [result, setResult] = useState(null);
  const eventRef = useRef(eventId);
  eventRef.current = eventId;
  const busyRef = useRef(false);

  const onResult = useCallback(async (text) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      // الـ QR فيه لينك ?k=الكود، أو الكود لوحده
      let code = text.trim();
      try {
        const k = new URL(code).searchParams.get('k');
        if (k) code = k;
      } catch { /* مش لينك، نستخدم النص زي ما هو */ }

      const { data, error } = await supabase.rpc('record_scan', {
        p_card_code: code,
        p_event_id: Number(eventRef.current),
      });
      if (error) throw error;
      setResult(describe(data));
    } catch (e) {
      setResult({ ok: false, text: friendlyError(e) });
    }
    // نسيب النتيجة ثانيتين وبعدين نرجّع الكاميرا للمسح التالي
    setTimeout(() => {
      setResult(null);
      busyRef.current = false;
      setRound((r) => r + 1);
    }, 2000);
  }, []);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-2xl bg-amber-400 py-4 text-lg font-extrabold text-amber-950 shadow"
      >
        📷 افتح الكاميرا
      </button>
    );
  }

  return (
    <div className="space-y-3">
      {result ? (
        <p
          className={`rounded-2xl p-6 text-center text-lg font-extrabold ${
            result.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
          }`}
        >
          {result.text}
        </p>
      ) : (
        <Suspense fallback={<p className="text-slate-500">جاري فتح الكاميرا...</p>}>
          <QrScanner key={round} onResult={onResult} onClose={() => setOpen(false)} />
        </Suspense>
      )}
      {result && (
        <button onClick={() => setOpen(false)} className="w-full rounded-xl bg-slate-200 py-2 font-semibold">
          إغلاق الكاميرا
        </button>
      )}
    </div>
  );
}

// توحيد الكتابة العربية (ة/ه، ى/ي، أ/إ/آ/ا، التشكيل) عشان البحث يلاقي الاسم بأي شكل
function norm(str) {
  return String(str ?? '')
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/* ——— تسجيل يدوي بالبحث بالاسم (لو الكارت ضاع) ——— */
function ListTab({ eventId }) {
  const [classes, setClasses] = useState([]);
  const [kids, setKids] = useState([]);
  const [search, setSearch] = useState('');
  const [selClass, setSelClass] = useState('');
  const [selKid, setSelKid] = useState(null);
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);

  // الـ 120 مخدوم تقريبًا بنحمّلهم مرة واحدة والبحث بيتم في المتصفح (لحظي)
  useEffect(() => {
    supabase.from('classes').select('id,name').order('name').then(({ data }) => setClasses(data ?? []));
    supabase
      .from('kids')
      .select('id,full_name,card_code,short_code,class_id')
      .eq('is_active', true)
      .order('full_name')
      .then(({ data }) => setKids(data ?? []));
  }, []);

  const className = (id) => classes.find((c) => c.id === id)?.name ?? '';
  const q = norm(search);
  const results = kids
    .filter((k) => !selClass || String(k.class_id) === selClass)
    .filter((k) => !q || norm(k.full_name).includes(q))
    .slice(0, 30);

  async function record() {
    if (!selKid) return;
    setLoading(true);
    setMsg(null);
    try {
      const { data, error } = await supabase.rpc('record_scan', {
        p_card_code: selKid.card_code || selKid.short_code,
        p_event_id: Number(eventId),
      });
      if (error) throw error;
      setMsg(describe(data, selKid.full_name));
      if (data?.type === 'ok') {
        setSelKid(null);
        setSearch('');
      }
    } catch (e) {
      setMsg({ ok: false, text: friendlyError(e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl bg-white p-5 shadow">
      <label className="block space-y-1">
        <span className="text-sm font-semibold text-slate-600">الفصل</span>
        <select
          className="w-full rounded-xl border border-slate-300 px-3 py-2"
          value={selClass}
          onChange={(e) => { setSelClass(e.target.value); setSelKid(null); }}
        >
          <option value="">كل الفصول</option>
          {classes.map((c) => (
            <option key={c.id} value={String(c.id)}>{c.name}</option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-semibold text-slate-600">ابحث بالاسم</span>
        <input
          type="search"
          className="w-full rounded-xl border border-slate-300 px-3 py-2"
          placeholder="اكتب أي جزء من الاسم..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setSelKid(null); setMsg(null); }}
          autoComplete="off"
        />
      </label>

      <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
        {results.length === 0 && <li className="p-3 text-center text-sm text-slate-400">مفيش نتايج</li>}
        {results.map((k) => (
          <li key={k.id}>
            <button
              type="button"
              onClick={() => { setSelKid(k); setMsg(null); }}
              className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start ${
                selKid?.id === k.id ? 'bg-indigo-50 font-bold text-indigo-800' : 'text-slate-700'
              }`}
            >
              <span>{k.full_name}</span>
              <span className="shrink-0 text-xs text-slate-400">{className(k.class_id)}</span>
            </button>
          </li>
        ))}
      </ul>

      {msg && (
        <p className={`rounded-xl p-3 text-sm font-semibold ${msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {msg.text}
        </p>
      )}

      <button
        onClick={record}
        disabled={loading || !selKid}
        className="w-full rounded-xl bg-indigo-700 py-3 font-bold text-white disabled:opacity-40"
      >
        {loading ? '...' : selKid ? `✓ تسجيل حضور ${selKid.full_name}` : 'اختار المخدوم من النتايج'}
      </button>
    </div>
  );
}


/* ——— ملخص النهارده للفعالية ——— */
const TIER = {
  1: { label: 'في الموعد', cls: 'bg-green-100 text-green-700' },
  2: { label: 'متأخر شوية', cls: 'bg-amber-100 text-amber-700' },
};
const tierOf = (pos) => TIER[pos] ?? { label: 'متأخر', cls: 'bg-orange-100 text-orange-700' };

function SummaryTab({ event, profile, ended }) {
  const [scans, setScans] = useState(null);
  const [kids, setKids] = useState([]);
  const [classes, setClasses] = useState([]);
  const [mine, setMine] = useState(true);
  const [confirmId, setConfirmId] = useState(null);
  const [openClass, setOpenClass] = useState(null); // فصل واحد بس مفتوح في المرة
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [sc, k, c] = await Promise.all([
      supabase
        .from('scans')
        .select('id,scanned_at,points,position,scanned_by,kid_id,kids(full_name,class_id)')
        .eq('event_id', event.id)
        .eq('service_date', cairoDate())
        .order('scanned_at', { ascending: false }),
      supabase.from('kids').select('id,full_name,class_id').eq('is_active', true).order('full_name'),
      supabase.from('classes').select('id,name').order('name'),
    ]);
    if (sc.error) throw sc.error;
    setScans(sc.data);
    setKids(k.data ?? []);
    setClasses(c.data ?? []);
  }, [event.id]);

  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, [load]);

  async function undo(scan) {
    setBusy(true);
    setErr('');
    try {
      const { data, error } = await supabase.rpc('undo_scan', { p_scan_id: scan.id });
      if (error) throw error;
      if (data?.type === 'not_today') return { ok: false, text: 'الفعالية دي مش النهارده' };
  if (data?.type === 'closed') throw new Error('الفعالية خلصت — مينفعش تراجع');
      setConfirmId(null);
      await load();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!scans) return <p className="text-center text-slate-500">{err || 'جاري التحميل...'}</p>;

  const myScans = scans.filter((s) => s.scanned_by === profile.id);
  const shown = mine ? myScans : scans;
  const scannedIds = new Set(scans.map((s) => s.kid_id));
  const missing = kids.filter((k) => !scannedIds.has(k.id));
  const className = (id) => classes.find((c) => c.id === id)?.name ?? '';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="سجّلت أنا" value={myScans.length} />
        <Stat label={`الكل من ${kids.length}`} value={scans.length} />
      </div>

      <div className="flex items-center gap-2">
        <Tab active={mine} onClick={() => setMine(true)}>أنا</Tab>
        <Tab active={!mine} onClick={() => setMine(false)}>الكل</Tab>
        <button onClick={() => load().catch((e) => setErr(e.message))} className="ms-auto rounded-xl bg-slate-200 px-3 py-2 text-sm font-semibold">
          ↻ تحديث
        </button>
      </div>

      {err && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-600">{err}</p>}

      <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow">
        {shown.length === 0 && <li className="p-4 text-center text-sm text-slate-400">لسه مفيش تسجيلات</li>}
        {shown.map((s) => {
          const t = tierOf(s.position);
          const isMine = s.scanned_by === profile.id || profile.role === 'admin';
          return (
            <li key={s.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-800">{s.kids?.full_name}</p>
                <p className="text-xs text-slate-400">
                  {className(s.kids?.class_id)} · {new Date(s.scanned_at).toLocaleTimeString('ar-EG', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <span className={`shrink-0 rounded-lg px-2 py-0.5 text-xs font-bold ${t.cls}`}>
                {t.label} · {s.points}
              </span>
              {isMine && !ended && (
                confirmId === s.id ? (
                  <span className="flex shrink-0 gap-2">
                    <button disabled={busy} onClick={() => undo(s)} className="text-xs font-bold text-red-600">تأكيد</button>
                    <button onClick={() => setConfirmId(null)} className="text-xs font-semibold text-slate-500">إلغاء</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmId(s.id)} className="shrink-0 text-xs font-semibold text-red-600">رجّع</button>
                )
              )}
            </li>
          );
        })}
      </ul>

      <section className="space-y-2">
        <h3 className="font-bold text-slate-700">لسه ماحضروش ({missing.length})</h3>
        {missing.length === 0 && <p className="rounded-2xl bg-green-50 p-4 text-center font-semibold text-green-700">كله حضر 🎉</p>}
        {classes.map((c) => {
          const list = missing.filter((k) => k.class_id === c.id);
          if (list.length === 0) return null;
          return (
            <div key={c.id} className="rounded-2xl bg-white shadow">
              <button
                type="button"
                onClick={() => setOpenClass(openClass === c.id ? null : c.id)}
                className="flex w-full items-center justify-between px-4 py-3 font-bold text-indigo-800"
                aria-expanded={openClass === c.id}
              >
                <span>{c.name}</span>
                <span className="flex items-center gap-2">
                  <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-sm text-red-600">{list.length} غايب</span>
                  <span className="text-slate-400">{openClass === c.id ? '▲' : '▼'}</span>
                </span>
              </button>
              {openClass === c.id && (
                <ul className="grid grid-cols-1 gap-1 border-t border-slate-100 p-3 sm:grid-cols-2">
                  {list.map((k) => (
                    <li key={k.id} className="rounded-lg bg-slate-50 px-3 py-1.5 text-sm text-slate-700">{k.full_name}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-2xl bg-white p-4 text-center shadow">
      <div className="text-3xl font-extrabold text-indigo-900">{value}</div>
      <div className="text-sm text-slate-500">{label}</div>
    </div>
  );
}

function Tab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl px-4 py-2 font-bold ${active ? 'bg-indigo-700 text-white' : 'bg-white text-slate-700 shadow'}`}
    >
      {children}
    </button>
  );
}
