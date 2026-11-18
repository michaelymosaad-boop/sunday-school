import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const POSITION_LABEL = { 1: 'في الموعد', 2: 'متأخر قليلاً', 3: 'متأخر' };

export default function KidPublic({ code }) {
  const [data, setData] = useState(null);
  const [board, setBoard] = useState([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: d, error } = await supabase.rpc('kid_lookup', { p_code: code });
        if (error) throw error;
        const { data: b } = await supabase
          .from('public_leaderboard')
          .select('full_name,class_name,total_points')
          .order('total_points', { ascending: false })
          .limit(10);
        if (!cancelled) {
          setData(d);
          setBoard(b ?? []);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setErr('حصلت مشكلة في تحميل البيانات، جرّب تاني');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (err) return <Shell><p className="text-center font-semibold text-red-600">{err}</p></Shell>;
  if (!data) return <Shell><p className="text-center text-slate-500">جاري التحميل...</p></Shell>;
  if (!data.found) {
    return (
      <Shell>
        <div className="rounded-2xl bg-white p-6 text-center shadow">
          <h1 className="text-xl font-extrabold text-red-600">الكارت ده مش مسجل</h1>
          <p className="mt-2 text-slate-600">كلم أمين الخدمة يتأكد من الكارت.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="rounded-2xl bg-emerald-50 p-4 text-center font-extrabold text-emerald-700">
        تم الدخول بنجاح ✅
      </div>

      <section className="flex flex-col items-center gap-3 rounded-2xl bg-white p-6 text-center shadow">
        {data.photo ? (
          <img src={data.photo} alt={data.name} className="h-28 w-28 rounded-full object-cover" />
        ) : (
          <div className="grid h-28 w-28 place-items-center rounded-full bg-indigo-100 text-3xl font-extrabold text-indigo-700">
            {data.name.charAt(0)}
          </div>
        )}
        <h1 className="text-xl font-extrabold text-indigo-900">{data.name}</h1>
        <p className="text-slate-500">{data.class}</p>
        <div className="grid w-full grid-cols-3 gap-3 pt-2">
          <Stat label="النقاط" value={data.points} />
          <Stat label="المركز" value={`${data.rank} من ${data.total}`} />
          <Stat label="الحضور" value={data.scans.length} />
        </div>
      </section>

      <section className="space-y-2 rounded-2xl bg-white p-5 shadow">
        <h2 className="font-extrabold text-indigo-900">حضورك</h2>
        {data.scans.length === 0 && <p className="text-slate-500">لسه مفيش حضور مسجل.</p>}
        <ul className="divide-y">
          {data.scans.map((s, i) => (
            <li key={i} className="flex justify-between py-2 text-sm">
              <span>
                {new Date(s.date).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })} · {s.event}
                <span className="text-slate-500"> · {POSITION_LABEL[s.position] ?? ''}</span>
              </span>
              <b className="text-indigo-700">+{s.points}</b>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2 rounded-2xl bg-white p-5 shadow">
        <h2 className="font-extrabold text-indigo-900">أبطال الخدمة</h2>
        <ol className="space-y-1">
          {board.map((r, i) => (
            <li
              key={i}
              className={`flex justify-between rounded-xl px-3 py-2 ${r.full_name === data.name ? 'bg-amber-100 font-bold' : ''}`}
            >
              <span>
                {i + 1}. {r.full_name}
                <span className="text-sm text-slate-500"> · {r.class_name}</span>
              </span>
              <span>{r.total_points}</span>
            </li>
          ))}
        </ol>
      </section>
    </Shell>
  );
}

function Shell({ children }) {
  return <div className="mx-auto max-w-md space-y-4 p-4">{children}</div>;
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-100 p-2">
      <div className="text-lg font-extrabold text-indigo-900">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
