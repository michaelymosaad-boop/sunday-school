import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// مكتبة قراءة QR تقيلة، بنأجل تحميلها لحد ما الخادم يفتح الكاميرا
const QrScanner = lazy(() => import('../components/QrScanner.jsx'));

export default function ServantHome({ profile }) {
  const [tab, setTab] = useState('camera');
  const [events, setEvents] = useState(null); // null = لسه بيحمّل
  const [selEvent, setSelEvent] = useState('');

  // الفعاليات المسموحة: الأدمن يشوف كل النشطة، والخادم يشوف المسندة له بس
  useEffect(() => {
    (async () => {
      let ids = null;
      if (profile.role !== 'admin') {
        const { data } = await supabase.from('staff_events').select('event_id').eq('staff_id', profile.id);
        ids = (data ?? []).map((r) => r.event_id);
      }
      if (ids && ids.length === 0) return setEvents([]);

      let q = supabase.from('events').select('id,name,start_time').eq('is_active', true).order('start_time');
      if (ids) q = q.in('id', ids);
      const { data } = await q;
      setEvents(data ?? []);
      if (data?.length) setSelEvent(String(data[0].id));
    })();
  }, [profile.id, profile.role]);

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
          مفيش فعاليات مسندة ليك دلوقتي. كلّم الأدمن.
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
                  {ev.name} — {ev.start_time?.slice(0, 5)}
                </option>
              ))}
            </select>
          </label>

          <nav className="flex gap-2">
            <Tab active={tab === 'camera'} onClick={() => setTab('camera')}>📷 مسح بالكاميرا</Tab>
            <Tab active={tab === 'list'} onClick={() => setTab('list')}>من القائمة</Tab>
          </nav>

          {tab === 'camera' && <CameraTab eventId={selEvent} />}
          {tab === 'list' && <ListTab eventId={selEvent} />}
        </>
      )}
    </div>
  );
}

// بيحوّل نتيجة الـ record_scan لرسالة للخادم
function describe(data, fallbackName) {
  const name = data?.kid || fallbackName || '';
  if (data?.type === 'duplicate') return { ok: false, text: `"${name}" اتسجل حضوره قبل كده` };
  if (data?.type === 'unknown') return { ok: false, text: 'الكارت ده مش معروف' };
  return { ok: true, text: `✅ ${name} — ${data?.points ?? 0} نقطة` };
}

function friendlyError(e) {
  const m = e?.message ?? '';
  if (m.includes('event not allowed')) return 'الفعالية دي مش مسموحة ليك';
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

/* ——— تسجيل يدوي من القائمة (لو الكارت ضاع) ——— */
function ListTab({ eventId }) {
  const [classes, setClasses] = useState([]);
  const [kids, setKids] = useState([]);
  const [selClass, setSelClass] = useState('');
  const [selKid, setSelKid] = useState('');
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.from('classes').select('id,name').order('name').then(({ data }) => setClasses(data ?? []));
  }, []);

  useEffect(() => {
    setSelKid('');
    if (!selClass) return setKids([]);
    supabase
      .from('kids')
      .select('id,full_name,card_code,short_code')
      .eq('class_id', selClass)
      .eq('is_active', true)
      .order('full_name')
      .then(({ data }) => setKids(data ?? []));
  }, [selClass]);

  async function record() {
    const kid = kids.find((k) => String(k.id) === selKid);
    if (!kid) return;
    setLoading(true);
    setMsg(null);
    try {
      const { data, error } = await supabase.rpc('record_scan', {
        p_card_code: kid.card_code || kid.short_code,
        p_event_id: Number(eventId),
      });
      if (error) throw error;
      setMsg(describe(data, kid.full_name));
      if (data?.type === 'ok') setSelKid('');
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
          onChange={(e) => setSelClass(e.target.value)}
        >
          <option value="">— اختار الفصل —</option>
          {classes.map((c) => (
            <option key={c.id} value={String(c.id)}>{c.name}</option>
          ))}
        </select>
      </label>

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
        {loading ? '...' : '✓ تسجيل الحضور'}
      </button>
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
