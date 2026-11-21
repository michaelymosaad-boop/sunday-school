import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import QRCode from 'qrcode';
import { supabase } from '../lib/supabase.js';
import { renderCardBlob, downloadBlob, safeFileName, uniqueNames } from '../lib/cardImages.js';

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

  const [editingClassId, setEditingClassId] = useState(null);
  const [editClassName, setEditClassName] = useState('');

  const [editingKidId, setEditingKidId] = useState(null);
  const [editKidName, setEditKidName] = useState('');
  const [editKidClass, setEditKidClass] = useState('');

  // حذف من القائمة
  const [deleteKidId, setDeleteKidId] = useState('');
  const [deleteClassId, setDeleteClassId] = useState('');

  const [selected, setSelected] = useState(() => new Set());
  const [downloadProgress, setDownloadProgress] = useState('');

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

  const selectedKids = visibleKids.filter((k) => selected.has(k.id));
  const allSelected = visibleKids.length > 0 && selectedKids.length === visibleKids.length;

  function changeFilter(value) {
    setFilterClass(value);
    setSelected(new Set());
  }

  function toggleKid(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(visibleKids.map((k) => k.id)));
  }

  async function buildCards(list) {
    const base = `${window.location.origin}${window.location.pathname}`;
    const names = uniqueNames(
      list.map((k) => `${safeFileName(k.full_name) || 'مخدوم'} - ${safeFileName(k.short_code)}.png`)
    );
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const k = list[i];
      setDownloadProgress(`بيجهز ${i + 1} من ${list.length}...`);
      const blob = await renderCardBlob({
        link: `${base}?k=${encodeURIComponent(k.short_code)}`,
        name: k.full_name,
        className: className(k.class_id),
        code: k.short_code,
      });
      out.push({ name: names[i], blob });
    }
    return out;
  }

  async function downloadImages() {
    const list = selectedKids;
    await run(async () => {
      const cards = await buildCards(list);
      for (let i = 0; i < cards.length; i++) {
        setDownloadProgress(`بيحمّل ${i + 1} من ${cards.length}...`);
        downloadBlob(cards[i].blob, cards[i].name);
        await new Promise((r) => setTimeout(r, 350));
      }
      setDownloadProgress('');
      setMsg(`اتحمّل ${cards.length} كارت كصور`);
    });
    setDownloadProgress('');
  }

  async function downloadZip() {
    const list = selectedKids;
    await run(async () => {
      const cards = await buildCards(list);
      setDownloadProgress('بيعمل الملف المضغوط...');
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      cards.forEach((c) => zip.file(c.name, c.blob));
      const blob = await zip.generateAsync({ type: 'blob' });
      const scope = filterClass ? safeFileName(className(Number(filterClass))) : 'كل الفصول';
      const date = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `كروت - ${scope} - ${date}.zip`);
      setDownloadProgress('');
      setMsg(`اتحمّل ملف مضغوط فيه ${cards.length} كارت`);
    });
    setDownloadProgress('');
  }

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

  function startEditClass(c) {
    setEditingClassId(c.id);
    setEditClassName(c.name);
  }

  function saveClass(e) {
    e.preventDefault();
    const n = editClassName.trim();
    if (!n) return;
    run(async () => {
      const { error } = await supabase.from('classes').update({ name: n }).eq('id', editingClassId);
      if (error) throw error;
      setEditingClassId(null);
      setMsg('تم تعديل اسم الفصل');
      await load();
    });
  }

  function deleteClass(c) {
    if (!c) return;
    const inClass = kids.filter((k) => k.class_id === c.id).length;
    if (inClass > 0) {
      setErr(`مينفعش تمسح "${c.name}" لسه فيه ${inClass} مخدوم فيه. انقلهم لفصل تاني أو امسحهم الأول.`);
      return;
    }
    if (!window.confirm(`متأكد إنك عايز تمسح فصل "${c.name}"؟`)) return;
    run(async () => {
      const { error } = await supabase.from('classes').delete().eq('id', c.id);
      if (error) throw error;
      setEditingClassId(null);
      setEditClassName('');
      setMsg('تم مسح الفصل');
      await load();
    });
  }

  function startEditKid(k) {
    setEditingKidId(k.id);
    setEditKidName(k.full_name);
    setEditKidClass(String(k.class_id));
  }

  function saveKid(e) {
    e.preventDefault();
    const n = editKidName.trim().replace(/\s+/g, ' ');
    if (!n || !editKidClass) return setErr('اكتب الاسم واختار الفصل');
    run(async () => {
      const { error } = await supabase
        .from('kids')
        .update({ full_name: n, class_id: Number(editKidClass) })
        .eq('id', editingKidId);
      if (error) throw error;
      setEditingKidId(null);
      setMsg('تم التعديل');
      await load();
    });
  }

  function deleteKid(k) {
    if (!k) return;
    if (!window.confirm(`متأكد إنك عايز تمسح "${k.full_name}"؟ هيتمسح معاه كل سجل حضوره ونقاطه، ومينفعش ترجعه.`)) return;
    run(async () => {
      const { error } = await supabase.from('kids').delete().eq('id', k.id);
      if (error) throw error;
      setEditingKidId(null);
      setEditKidName('');
      setEditKidClass('');
      setDeleteKidId('');
      setMsg('تم المسح');
      await load();
    });
  }

  function deleteKidById() {
    const k = kids.find((x) => String(x.id) === deleteKidId);
    deleteKid(k);
  }

  function deleteClassById() {
    const c = classes.find((x) => String(x.id) === deleteClassId);
    deleteClass(c);
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

        {classes.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {classes.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                {editingClassId === c.id ? (
                  <form onSubmit={saveClass} className="flex flex-1 gap-2">
                    <input
                      className="flex-1 rounded-xl border border-slate-300 px-3 py-1.5"
                      value={editClassName}
                      onChange={(e) => setEditClassName(e.target.value)}
                      autoFocus
                    />
                    <button disabled={busy} className="rounded-xl bg-indigo-700 px-3 py-1.5 text-sm font-bold text-white">
                      حفظ
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingClassId(null)}
                      className="rounded-xl bg-slate-200 px-3 py-1.5 text-sm font-semibold"
                    >
                      إلغاء
                    </button>
                  </form>
                ) : (
                  <>
                    <span className="font-semibold text-slate-700">{c.name}</span>
                    <div className="flex gap-2">
                      <button onClick={() => startEditClass(c)} className="text-sm font-semibold text-indigo-700">
                        تعديل
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* حذف فصل بالقائمة */}
        <div className="border-t border-slate-100 pt-3">
          <p className="mb-2 text-sm font-semibold text-slate-500">حذف فصل (لازم يكون فاضي من المخدومين)</p>
          <div className="flex gap-2">
            <select
              className="flex-1 rounded-xl border border-slate-300 px-3 py-2"
              value={deleteClassId}
              onChange={(e) => setDeleteClassId(e.target.value)}
            >
              <option value="">— اختار الفصل —</option>
              {classes.map((c) => (
                <option key={c.id} value={String(c.id)}>{c.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={deleteClassById}
              disabled={busy || !deleteClassId}
              className="rounded-xl bg-red-600 px-4 py-2 font-bold text-white disabled:opacity-40"
            >
              حذف
            </button>
          </div>
        </div>
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
              onChange={(e) => changeFilter(e.target.value)}
              aria-label="فلتر الفصل"
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

        {visibleKids.length > 0 && (
          <div className="no-print flex flex-wrap items-center gap-3 rounded-xl bg-indigo-50 p-3">
            <label className="flex cursor-pointer items-center gap-2 font-semibold text-indigo-900">
              <input
                type="checkbox"
                className="h-4 w-4 accent-indigo-700"
                checked={allSelected}
                onChange={toggleAll}
              />
              اختار الكل
            </label>
            <span className="text-sm text-slate-600" aria-live="polite">
              مختار {selectedKids.length} من {visibleKids.length}
            </span>
            <div className="ms-auto flex flex-wrap gap-2">
              <button
                onClick={downloadImages}
                disabled={busy || selectedKids.length === 0}
                className="rounded-xl bg-indigo-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                تحميل كصور
              </button>
              <button
                onClick={downloadZip}
                disabled={busy || selectedKids.length === 0}
                className="rounded-xl border border-indigo-700 bg-white px-4 py-2 text-sm font-bold text-indigo-700 disabled:opacity-50"
              >
                تحميل ملف مضغوط
              </button>
            </div>
            {downloadProgress && (
              <p className="w-full text-sm font-semibold text-indigo-700" aria-live="polite">
                {downloadProgress}
              </p>
            )}
          </div>
        )}

        <div className="print-area grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {visibleKids.map((k) =>
            editingKidId === k.id ? (
              <form
                key={k.id}
                onSubmit={saveKid}
                className="no-print flex flex-col gap-2 rounded-xl border border-indigo-300 bg-indigo-50 p-3"
              >
                <input
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  value={editKidName}
                  onChange={(e) => setEditKidName(e.target.value)}
                  autoFocus
                />
                <select
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  value={editKidClass}
                  onChange={(e) => setEditKidClass(e.target.value)}
                >
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button disabled={busy} className="flex-1 rounded-lg bg-indigo-700 py-1.5 text-sm font-bold text-white">
                    حفظ
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingKidId(null)}
                    className="flex-1 rounded-lg bg-slate-200 py-1.5 text-sm font-semibold"
                  >
                    إلغاء
                  </button>
                </div>
              </form>
            ) : (
              <div
                key={k.id}
                className={`kid-card relative flex flex-col items-center rounded-xl border p-3 text-center ${
                  selected.has(k.id) ? 'border-indigo-500 ring-2 ring-indigo-200 print:border-slate-200 print:ring-0' : 'border-slate-200'
                }`}
              >
                <input
                  type="checkbox"
                  className="no-print absolute end-2 top-2 h-4 w-4 cursor-pointer accent-indigo-700"
                  checked={selected.has(k.id)}
                  onChange={() => toggleKid(k.id)}
                  aria-label={`اختيار ${k.full_name}`}
                />
                {qrs[k.id] ? <img src={qrs[k.id]} alt="" className="h-28 w-28" /> : <div className="h-28 w-28" />}
                <div className="mt-2 font-bold text-slate-800">{k.full_name}</div>
                <div className="text-xs text-slate-500">{className(k.class_id)}</div>
                <div className="mt-1 font-mono text-xs tracking-widest text-slate-400">{k.short_code}</div>
                <div className="no-print mt-2 flex gap-3">
                  <button onClick={() => startEditKid(k)} className="text-xs font-semibold text-indigo-700">
                    تعديل
                  </button>
                  <button onClick={() => deleteKid(k)} className="text-xs font-semibold text-red-600">
                    مسح
                  </button>
                </div>
              </div>
            )
          )}
        </div>
        {visibleKids.length === 0 && <p className="text-slate-500">مفيش مخدومين لسه.</p>}
      </section>
    </div>
  );
}
