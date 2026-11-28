import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const POSITION_LABEL = { 1: 'في الموعد', 2: 'متأخر قليلاً', 3: 'متأخر' };
const MEDALS = ['🥇', '🥈', '🥉'];

export default function KidPublic({ code }) {
  const [data, setData] = useState(null);
  const [board, setBoard] = useState([]);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('me');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ data: d, error }, { data: b, error: bErr }] = await Promise.all([
          supabase.rpc('kid_lookup', { p_code: code }),
          supabase
            .from('public_leaderboard')
            .select('kid_id,full_name,photo_url,class_name,total_points')
            .order('total_points', { ascending: false }),
        ]);
        if (error) throw error;
        if (bErr) throw bErr;
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

  if (err) {
    return (
      <Shell>
        <Center><p className="font-semibold text-red-600">{err}</p></Center>
      </Shell>
    );
  }
  if (!data) {
    return (
      <Shell>
        <Center><p className="text-slate-500">جاري التحميل...</p></Center>
      </Shell>
    );
  }
  if (!data.found) {
    return (
      <Shell>
        <Center>
          <div className="rounded-2xl bg-white p-6 text-center shadow">
            <h1 className="text-xl font-extrabold text-red-600">الكارت ده مش مسجل</h1>
            <p className="mt-2 text-slate-600">كلم أمين الخدمة يتأكد من الكارت.</p>
          </div>
        </Center>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex-1 space-y-4 overflow-y-auto pb-24 pt-4">
        {tab === 'me' && <MeTab data={data} />}
        {tab === 'board' && <BoardTab data={data} board={board} />}
        {tab === 'points' && <PointsTab data={data} />}
      </div>
      <BottomNav tab={tab} setTab={setTab} />
    </Shell>
  );
}

/* ——— إنت مين ——— */
function MeTab({ data }) {
  return (
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
  );
}

/* ——— الترتيب ——— */
function withRanks(rowsSortedDesc) {
  let rank = 0;
  let prevPoints = null;
  let seen = 0;
  return rowsSortedDesc.map((r) => {
    seen += 1;
    if (r.total_points !== prevPoints) {
      rank = seen;
      prevPoints = r.total_points;
    }
    return { ...r, rank };
  });
}

function BoardTab({ data, board }) {
  const [scope, setScope] = useState('all'); // 'all' | 'class'

  const rows = useMemo(() => {
    const base = scope === 'class' ? board.filter((r) => r.class_name === data.class) : board;
    return withRanks(base);
  }, [board, scope, data.class]);

  const top = rows.slice(0, 3);
  const rest = rows.slice(3, 12);
  const me = rows.find((r) => r.kid_id === data.kid_id);
  const meShown = top.some((r) => r.kid_id === data.kid_id) || rest.some((r) => r.kid_id === data.kid_id);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Chip active={scope === 'all'} onClick={() => setScope('all')}>الخدمة كلها</Chip>
        <Chip active={scope === 'class'} onClick={() => setScope('class')}>فصلي بس</Chip>
      </div>

      {top.length === 0 && (
        <p className="rounded-2xl bg-white p-6 text-center text-slate-400 shadow">لسه مفيش نقط مسجلة.</p>
      )}

      {top.length > 0 && (
        <div className="flex items-end justify-center gap-2 rounded-2xl bg-gradient-to-b from-indigo-50 to-white p-4 pt-8 shadow">
          {[top[1], top[0], top[2]].map(
            (r, i) =>
              r && (
                <PodiumCard key={r.kid_id} row={r} place={i === 1 ? 1 : i === 0 ? 2 : 3} isMe={r.kid_id === data.kid_id} />
              )
          )}
        </div>
      )}

      {rest.length > 0 && (
        <ol className="divide-y divide-slate-100 rounded-2xl bg-white shadow">
          {rest.map((r) => (
            <li
              key={r.kid_id}
              className={`flex items-center justify-between gap-2 px-4 py-2.5 ${
                r.kid_id === data.kid_id ? 'bg-amber-50' : ''
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-6 shrink-0 text-center text-sm font-bold text-slate-400">{r.rank}</span>
                <span className={`truncate font-semibold ${r.kid_id === data.kid_id ? 'text-amber-800' : 'text-slate-700'}`}>
                  {r.full_name}
                </span>
              </span>
              <span className="shrink-0 font-bold text-indigo-700">{r.total_points}</span>
            </li>
          ))}
        </ol>
      )}

      {!meShown && me && (
        <div className="rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50 p-3">
          <p className="mb-1 text-center text-xs text-slate-500">مركزك</p>
          <div className="flex items-center justify-between px-2">
            <span className="font-bold text-amber-800">{me.rank}. {me.full_name}</span>
            <span className="font-bold text-indigo-700">{me.total_points}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function PodiumCard({ row, place, isMe }) {
  const height = place === 1 ? 'h-28' : place === 2 ? 'h-20' : 'h-16';
  const bg = place === 1 ? 'bg-amber-400' : place === 2 ? 'bg-slate-300' : 'bg-orange-300';
  return (
    <div className="flex w-20 flex-col items-center gap-1">
      <span className="text-2xl">{MEDALS[place - 1]}</span>
      <span className={`w-full truncate text-center text-xs font-bold ${isMe ? 'text-amber-700' : 'text-slate-700'}`}>
        {row.full_name}
      </span>
      <span className="text-xs font-bold text-indigo-700">{row.total_points}</span>
      <div className={`w-full rounded-t-xl ${height} ${bg}`} />
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-xl px-3 py-2 text-sm font-bold ${
        active ? 'bg-indigo-700 text-white' : 'bg-white text-slate-600 shadow-sm'
      }`}
    >
      {children}
    </button>
  );
}

/* ——— نقاطي ——— */
function PointsTab({ data }) {
  return (
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
  );
}

/* ——— القالب العام + التنقل السفلي ——— */
function Shell({ children }) {
  return <div className="mx-auto flex min-h-screen max-w-md flex-col px-4">{children}</div>;
}

function Center({ children }) {
  return <div className="grid flex-1 place-items-center">{children}</div>;
}

function BottomNav({ tab, setTab }) {
  const items = [
    { id: 'me', label: 'إنت مين', icon: '🙋' },
    { id: 'board', label: 'الترتيب', icon: '🏆' },
    { id: 'points', label: 'نقاطي', icon: '⭐' },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 mx-auto flex max-w-md border-t border-slate-200 bg-white/95 backdrop-blur">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => setTab(it.id)}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-bold ${
            tab === it.id ? 'text-indigo-700' : 'text-slate-400'
          }`}
        >
          <span className="text-lg">{it.icon}</span>
          {it.label}
        </button>
      ))}
    </nav>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-100 p-2">
      <div className="text-lg font-extrabold text-indigo-900">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
