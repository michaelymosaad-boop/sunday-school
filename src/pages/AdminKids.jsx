import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import QRCode from 'qrcode';
import { supabase } from '../lib/supabase.js';

const COL_NAME = 'الاسم الثلاثي';
const COL_CLASS = 'الفصل';

// بيقرا الصف بأي مسافات زيادة في اسم العمود
function readCol(row, header) {
  const key = Object.keys(row).find((k) => k.trim() === header);
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
      supabase.from('kids').select('id,full_name,card_code,class_id').order('full_name'),
    ]);
    if (c.error) throw c.error;
    if (k.error) throw k.error;
    setClasses(c.data);
    setKids(k.data);
  }

  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, []);

  // كود QR لكل كارت (بيتولد في المتصفح من كود الكارت)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out = {};
      for (const k of kids) {
        out[k.id] = await QRCode.toDataURL(k.card_code, { width: 220, margin: 1 });
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

  function importFile(file) {
    run(async () => {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      const clean = rows
        .map((r) => ({ name: readCol(r, COL_NAME), cls: readCol(r, COL_CLASS) }))
        .filter((r) => r.name || r.cls);

      const bad = clean.filter((r) => !r.name || !r.cls);
      if (bad.length) throw new Error(`في ${bad.length} صف ناقص اسم أو فصل. صلّحه وارفع الملف تاني`);
      if (!clean.length) throw new Error('الملف فاضي أو اسم العمود غلط');

      // 1) الفصول الجديدة
      const classNames = [...new Set(clean.map((r) => r.cls))];
      const { error: ce } = await supabase
        .from('classes')
        .upsert(classNames.map((n) => ({ name: n })), { onConflict: 'name', ignoreDuplicates: true });
      if (ce) throw ce;

      // 2) نجيب الـ ids
      const { data: allClasses, error: qe } = await supabase.from('classes').select('id,name');
      if (qe) throw qe;
      const idByName = new Map(allClasses.map((c) => [c.name, c.id]));

      // 3) نتجاهل المخدومين الموجودين في نفس الفصل
      const { data: existing, error: ee } = await supabase.from('kids').select('full_name,class_id');
      if (ee) throw ee;
      const seen = new Set(existing.map((k) => `${k.class_id}|${k.full_name}`));

      const toInsert = [];
      let skipped = 0;
      for (const r of clean) {
        const class_id = idByName.get(r.cls);
        const key = `${class_id}|${r.name}`;
        if (seen.has(key)) {
          skipped++;
          continue;
        }
        seen.add(key);
        toInsert.push({ full_name: r.name, class_id });
      }

      // 4) الإضافة على دفعات
      for (let i = 0; i < toInsert.length; i += 100) {
        const { error } = await supabase.from('kids').insert(toInsert.slice(i, i + 100));
        if (error) throw error;
      }

      setMsg(`تم إضافة ${toInsert.length} مخدوم، واتجاهل ${skipped} لأنهم موجودين قبل كده`);
      await load();
    });
  }

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      [COL_NAME, COL_CLASS],
      ['مينا جورج إبراهيم', 'الصف الرابع'],
      ['مريم سامح فايز', 'الصف الخامس'],
    ]);
    ws['!cols'] = [{ wch: 30 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'المخدومين');
    XLSX.writeFile(wb, 'قالب-المخدومين.xlsx');
  }

  return (
    <div className="space-y-6">
      {/* رسائل */}
      {msg && <p className="rounded-xl bg-emerald-50 p-3 font-semibold text-emerald-700">{msg}</p>}
      {err && <p className="rounded-xl bg-red-50 p-3 font-semibold text-red-600">{err}</p>}

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
          الملف لازم فيه عمودين بالاسم بالظبط: <b>{COL_NAME}</b> و<b>{COL_CLASS}</b>. الفصل لو مش موجود هيتضاف لوحده.
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

      {/* قائمة المخدومين وكروت QR */}
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
            </div>
          ))}
        </div>
        {visibleKids.length === 0 && <p className="text-slate-500">مفيش مخدومين لسه.</p>}
      </section>
    </div>
  );
}
