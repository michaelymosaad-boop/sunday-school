// دالة الاستيراد: بتقرا صورة الكارت من Drive، تفك الـ QR، وتضيف المخدوم
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import jsQR from 'npm:jsqr@1.4.0';
import { PNG } from 'npm:pngjs@7.0.0';
import jpeg from 'npm:jpeg-js@0.4.4';
import { Buffer } from 'node:buffer';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// بيطلّع رقم الملف من لينك Drive (شكلين)
function driveId(url: string): string | null {
  const m = url.match(/\/d\/([\w-]{10,})/) || url.match(/[?&]id=([\w-]{10,})/);
  return m ? m[1] : null;
}

// بيفك الـ QR من صورة PNG أو JPEG
function decodeQR(buf: Uint8Array): string | null {
  let rgba: Uint8ClampedArray;
  let width: number;
  let height: number;
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    const png = PNG.sync.read(Buffer.from(buf));
    rgba = new Uint8ClampedArray(png.data);
    width = png.width;
    height = png.height;
  } else if (buf[0] === 0xff && buf[1] === 0xd8) {
    const img = jpeg.decode(Buffer.from(buf), { useTArray: true, formatAsRGBA: true });
    rgba = new Uint8ClampedArray(img.data);
    width = img.width;
    height = img.height;
  } else {
    return null;
  }
  const code = jsQR(rgba, width, height);
  return code ? code.data : null;
}

// الـ QR ممكن يكون كود خام، أو لينك للموقع فيه ?k=الكود
function codeFromQR(text: string): string {
  if (text.startsWith('http')) {
    try {
      const k = new URL(text).searchParams.get('k');
      if (k) return k;
    } catch (_) {
      /* نرجع النص كما هو */
    }
  }
  return text.trim();
}

async function fetchDrive(url: string): Promise<Uint8Array> {
  const id = driveId(url);
  if (!id) throw new Error('لينك Drive مش صح');
  const res = await fetch(`https://drive.google.com/uc?export=download&id=${id}`, { redirect: 'follow' });
  if (!res.ok) throw new Error('الملف مش متاح. اتأكد إنه Anyone with the link');
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('image/')) throw new Error('الملف مش صورة (ممكن الملف كبير أو مش متاح)');
  return new Uint8Array(await res.arrayBuffer());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // 1) لازم يكون أدمن
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: isAdmin } = await userClient.rpc('is_admin');
  if (!isAdmin) return json({ error: 'للأدمن بس' }, 403);

  const admin = createClient(url, serviceKey);
  const body = await req.json();
  const rows: Array<{ name: string; cls: string; cardUrl: string; photoUrl?: string; birth?: string; phone?: string }> =
    body.rows ?? [];

  const report = { added: 0, skipped: [] as string[], errors: [] as string[] };

  // 2) الفصول
  const classNames = [...new Set(rows.map((r) => (r.cls ?? '').trim()).filter(Boolean))];
  if (classNames.length) {
    const { error } = await admin
      .from('classes')
      .upsert(classNames.map((name) => ({ name })), { onConflict: 'name', ignoreDuplicates: true });
    if (error) return json({ error: error.message }, 500);
  }
  const { data: allClasses } = await admin.from('classes').select('id,name');
  const classId = new Map((allClasses ?? []).map((c) => [c.name, c.id]));

  // 3) الكودات والأسماء الموجودة قبل كده
  const { data: existing } = await admin.from('kids').select('full_name,class_id,card_code');
  const codes = new Set((existing ?? []).map((k) => k.card_code));
  const names = new Set((existing ?? []).map((k) => `${k.class_id}|${k.full_name}`));

  // 4) كل صف
  for (const [i, r] of rows.entries()) {
    const label = `صف ${i + 1} (${r.name ?? ''})`;
    try {
      const name = (r.name ?? '').trim().replace(/\s+/g, ' ');
      const cls = (r.cls ?? '').trim();
      if (!name || !cls || !r.cardUrl) {
        report.errors.push(`${label}: الاسم أو الفصل أو لينك الكارت فاضي`);
        continue;
      }
      const cid = classId.get(cls);
      if (!cid) {
        report.errors.push(`${label}: الفصل مش موجود`);
        continue;
      }
      if (names.has(`${cid}|${name}`)) {
        report.skipped.push(`${label}: موجود قبل كده`);
        continue;
      }

      const img = await fetchDrive(r.cardUrl);
      const text = decodeQR(img);
      if (!text) {
        report.errors.push(`${label}: مش لاقي QR في صورة الكارت`);
        continue;
      }
      const code = codeFromQR(text);
      if (codes.has(code)) {
        report.skipped.push(`${label}: الكارت ده مسجل قبل كده`);
        continue;
      }

      const pid = r.photoUrl ? driveId(r.photoUrl) : null;
      const photo = pid ? `https://drive.google.com/thumbnail?id=${pid}&sz=w400` : null;

      const { data: kid, error: kErr } = await admin
        .from('kids')
        .insert({ full_name: name, class_id: cid, card_code: code, photo_url: photo })
        .select('id')
        .single();
      if (kErr) throw kErr;

      if (r.birth || r.phone) {
        const { error: dErr } = await admin
          .from('kid_details')
          .insert({ kid_id: kid.id, birth_date: r.birth || null, phone: r.phone || null });
        if (dErr) throw dErr;
      }

      codes.add(code);
      names.add(`${cid}|${name}`);
      report.added++;
    } catch (e) {
      report.errors.push(`${label}: ${(e as Error).message}`);
    }
  }

  return json(report);
});

export { codeFromQR, driveId, decodeQR };
