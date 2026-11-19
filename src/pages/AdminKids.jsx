import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import QRCode from 'qrcode';
import { supabase } from '../lib/supabase.js';

const COL = {
  name: 'الاسم الثلاثي',
  cls: 'الفصل',
  card: 'رابط الكارت',
  photo: 'رابط الصورة',
  birth: 'تاريخ الميلاد',
  phone: 'رقم التليفون',
};

// توحيد كتابة العربي (ة/ه، ى/ي، أ/ا) والمسافات، عشان "الصوره" و"الصورة" يبقوا نفس العمود
function norm(s) {
  return String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[أإآ]/g, 'ا');
}

// بيقرا الصف بأي مسافات أو اختلاف في كتابة اسم العمود
function readCol(row, header) {
  const want = norm(header);
  const key = Object.keys(row).find((k) => norm(k) === want);
  return key ? String(row[key] ?? '').trim().replace(/\s+/g, ' ') : '';
}

export default function AdminKids() {
  const [classes, setClasses] = useState([]);
  const [kids, setKids] = useState([]);
  const [qrs, setQrs] = useState({});
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const [newClass, setNewClass] = useState('');
  const [name, setName] = useState('');
  const [classId, setClassId] = useState('');
  const [filterClass, setFilterClass] = useState('');

  async function load() {
    const [c, k] = await Promise.all([
      supabase.from('classes').select('id,name').order('name'),
      supabase.from('kids').select('id,full_name,card_code,short_code,class_id').order('full_name'),
    ]);
    if (c.error) throw c.error;
    if (k.error) throw k.error;
    setClasses(c.data);
    setKids(k.data);
  }

  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, []);

  // كيوار الطباعة بتاعنا بيفتح الموقع مباشرة (بالكود المختصر) عشان يشتغل من أي كاميرا موبايل عادية
  // (مختلف تمامًا عن كيوار الكارت الأصلي بتاع أبناء النور، ده ما بيتلمسش خالص)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const base = `${window.location.origin}${window.location.pathname}`;
      const out = {};
      for (const k of kids) {
        const link = `${base}?k=${encodeURIComponent(k.short_code)}`;
        out[k.id] = await QRCode.toDataURL(link, { width: 220, margin: 1 });
      }
      if (!cancelled) setQrs(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [kids]);

  const className = (id) => classes.find((c) => c.id === id)?.name ?? '';
  const visibleKids = filterClass ? kids.filter((k) => String(k.class_id) === filterClass) : kids;

  async function run(fn) {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      await fn();
    } catch (e) {
      setErr(e.code === '23505' ? 'الاسم ده موجود قبل كده' : e.message);
    } finally {
      setBusy(false);
    }
  }

  function addClass(e) {
    e.preventDefault();
    const n = newClass.trim();
    if (!n) return;
    run(async () => {
      const { error } = await supabase.from('classes').insert({ name: n });
      if (error) throw error;
      setNewClass('');
      setMsg('تم إضافة الفصل');
      await load();
    });
  }

  function addKid(e) {
    e.preventDefault();
    const n = name.trim().replace(/\s+/g, ' ');
    if (!n || !classId) return setErr('اكتب الاسم واختار الفصل');
    run(async () => {
      const { error } = await supabase.from('kids').insert({ full_name: n, class_id: Number(classId) });
      if (error) throw error;
      setName('');
      setMsg(`تم إضافة ${n}`);
      await load();
    });
  }

  // الاستيراد: الملف بيتقري هنا، وكل صف بيتبعت للسيرفر يفك الـ QR من لينك الكارت
  function importFile(file) {
    run(async () => {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
      const rows = raw
        .map((r) => ({
          name: readCol(r, COL.name),
          cls: readCol(r, COL.cls),
          cardUrl: readCol(r, COL.card),
          photoUrl: readCol(r, COL.photo),
          birth: readCol(r, COL.birth),
          phone: readCol(r, COL.phone),
        }))
        .filter((r) => r.name || r.cls || r.cardUrl);
      if (!rows.length) throw new Error('الملف فاضي أو أسماء الأعمدة غلط');

      const total = { added: 0, skipped: [], errors: [], warnings: [] };
      for (let i = 0; i < rows.length; i += 10) {
        setMsg(`بيتم الاستيراد... ${Math.min(i + 10, rows.length)} من ${rows.length}`);
        const { data, error } = await supabase.functions.invoke('import-kids', {
          body: { rows: rows.slice(i, i + 10) },
        });
        if (error) throw error;
        total.added += data.added;
        total.skipped.push(...data.skipped);
        total.errors.push(...data.errors);
        total.warnings.push(...(data.warnings ?? []));
      }

      setMsg(`تم إضافة ${total.added} مخدوم. اتجاهل ${total.skipped.length}.`);
      const problems = [...total.errors, ...total.warnings];
      if (problems.length) setErr(`ملاحظات (${problems.length}):\n` + problems.join('\n'));
      await load();
    });
  }

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      [COL.name, COL.cls, COL.card, COL.photo, COL.birth, COL.phone],
      ['مينا جورج إبراهيم', 'الصف الرابع', 'https://drive.google.com/file/d/ID-الكارت/view', 'https://drive.google.com/file/d/ID-الصورة/view', '2014-05-12', '01000000000'],
      ['فادي سمير نجيب', 'الصف الرابع', '', 'https://drive.google.com/file/d/ID-الصورة/view', '', ''],
    ]);
    ws['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 55 }, { wch: 55 }, { wch: 14 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'المخدومين');
    XLSX.writeFile(wb, 'قالب-المخدومين.xlsx');
  }

  return (
    <div className="space-y-6">
      {msg && <p className="rounded-xl bg-emerald-50 p-3 font-semibold text-emerald-700">{msg}</p>}
      {err && <p className="whitespace-pre-line rounded-xl bg-red-50 p-3 font-semibold text-red-600">{err}</p>}

      {/* الفصول */}
      <section className="space-y-3 rounded-2xl bg-white p-5 shadow">
        <h2 className="text-lg font-extrabold text-indigo-900">الفصول ({classes.length})</h2>
        <form onSubmit={addClass} className="flex gap-2">
          <input
            className="flex-1 rounded-xl border border-slate-300 px-3 py-2"
            placeholder="اسم الفصل، مثلاً: الصف الرابع"
            value={newClass}
            onChange={(e) => setNewClass(e.target.value)}
          />
          <button disabled={busy} className="rounded-xl bg-indigo-700 px-4 font-bold text-white disabled:opacity-60">
            إضافة فصل
          </button>
        </form>
      </section>

      {/* إضافة يدوية */}
      <section className="space-y-3 rounded-2xl bg-white p-5 shadow">
        <h2 className="text-lg font-extrabold text-indigo-900">إضافة مخدوم يدوي</h2>
        <form onSubmit={addKid} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            className="rounded-xl border border-slate-300 px-3 py-2"
            placeholder="الاسم الثلاثي"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select
            className="rounded-xl border border-slate-300 px-3 py-2"
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
          >
            <option value="">اختار الفصل</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button disabled={busy} className="rounded-xl bg-indigo-700 px-4 py-2 font-bold text-white disabled:opacity-60">
            إضافة
          </button>
        </form>
      </section>

      {/* استيراد من Excel */}
      <section className="space-y-3 rounded-2xl bg-white p-5 shadow">
        <h2 className="text-lg font-extrabold text-indigo-900">استيراد من Excel</h2>
        <p className="text-sm text-slate-500">
          لازم: <b>{COL.name}</b> و<b>{COL.cls}</b> و<b>{COL.photo}</b> (لينك الصورة من Drive).
          اختياري: <b>{COL.card}</b> — لو عند المخدوم كارت QR جاهز من قبل (زي أبناء النور) حط لينك صورة الكارت هنا وهنفك
          الكود منه، ولو مفيش سيبه فاضي وهنولّد كود جديد للمخدوم تلقائي. واختياري كمان: <b>{COL.birth}</b> و<b>{COL.phone}</b>.
          الملفات في Drive لازم تكون Anyone with the link.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={downloadTemplate} className="rounded-xl bg-slate-200 px-4 py-2 font-semibold">
            تحميل القالب
          </button>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={busy}
            onChange={(e) => e.target.files[0] && importFile(e.target.files[0])}
            className="text-sm"
          />
        </div>
      </section>

      {/* قائمة المخدومين */}
      <section className="space-y-3 rounded-2xl bg-white p-5 shadow">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-extrabold text-indigo-900">المخدومين ({visibleKids.length})</h2>
          <div className="flex gap-2">
            <select
              className="rounded-xl border border-slate-300 px-3 py-2"
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
            >
              <option value="">كل الفصول</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button onClick={() => window.print()} className="no-print rounded-xl bg-slate-200 px-4 py-2 font-semibold">
              طباعة الكروت
            </button>
          </div>
        </div>

        <div className="print-area grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {visibleKids.map((k) => (
            <div key={k.id} className="kid-card flex flex-col items-center rounded-xl border border-slate-200 p-3 text-center">
              {qrs[k.id] ? <img src={qrs[k.id]} alt="" className="h-28 w-28" /> : <div className="h-28 w-28" />}
              <div className="mt-2 font-bold text-slate-800">{k.full_name}</div>
              <div className="text-xs text-slate-500">{className(k.class_id)}</div>
              <div className="mt-1 font-mono text-xs tracking-widest text-slate-400">{k.short_code}</div>
            </div>
          ))}
        </div>
        {visibleKids.length === 0 && <p className="text-slate-500">مفيش مخدومين لسه.</p>}
      </section>
    </div>
  );
}
