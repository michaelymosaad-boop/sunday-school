// Edge Function: create-servant
// بيتنفذ على السيرفر بـ service_role key عشان يقدر ينشئ users
// الأدمن بس هو اللي يستدعيه (بيتأكد من الـ JWT)

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ——— تأكد إن المستخدم الحالي أدمن ———
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Client بـ anon key عشان نتحقق من المستخدم الحالي
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // تحقق من إن المستخدم أدمن
    const { data: profile, error: profErr } = await supabaseUser
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profErr || profile?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden — admins only' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ——— اقرأ البيانات ———
    const body = await req.json();

    // حذف خادم: بيمسح حساب الدخول نفسه (profile + staff_events بيتمسحوا cascade)
    if (body.action === 'delete') {
      const admin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      );
      const { data: target } = await admin.from('profiles').select('role').eq('id', body.id).maybeSingle();
      if (target?.role !== 'servant') {
        return new Response(JSON.stringify({ error: 'مش خادم' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { error: delErr } = await admin.auth.admin.deleteUser(body.id);
      if (delErr) {
        return new Response(JSON.stringify({ error: delErr.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { login_name, display_name, password, event_ids } = body;

    if (!login_name?.trim() || !display_name?.trim() || !password?.trim()) {
      return new Response(JSON.stringify({ error: 'بيانات ناقصة' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (password.length < 8) {
      return new Response(JSON.stringify({ error: 'كلمة السر لازم تكون 8 حروف على الأقل' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ——— إنشاء الـ user بـ service_role ———
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // اسم الدخول بيبقى الـ email المؤقت (login_name@servants.local)
    // UUID عشان الاسم العربي ممكن يترفض كإيميل (الدخول بيتم بالاسم عن طريق resolve_login)
    const fakeEmail = `${crypto.randomUUID()}@servants.local`;

    // تأكد مفيش حساب بنفس اسم الدخول
    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('login_name', login_name.trim())
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ error: `اسم الدخول "${login_name.trim()}" موجود قبل كده` }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: fakeEmail,
      password: password.trim(),
      email_confirm: true, // bypass email confirmation
    });

    if (createErr) {
      return new Response(JSON.stringify({ error: createErr.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ——— إنشاء الـ profile ———
    const { error: profileErr } = await supabaseAdmin.from('profiles').insert({
      id: newUser.user.id,
      role: 'servant',
      login_name: login_name.trim(),
      display_name: display_name.trim(),
      must_change_password: true,
      is_active: true,
    });

    if (profileErr) {
      // cleanup the auth user if profile insert fails
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
      return new Response(JSON.stringify({ error: profileErr.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ——— إسناد الفعاليات ———
    const ids: number[] = Array.isArray(event_ids) ? event_ids : [];
    if (ids.length > 0) {
      const rows = ids.map((eid) => ({ staff_id: newUser.user.id, event_id: eid }));
      const { error: evtErr } = await supabaseAdmin.from('staff_events').insert(rows);
      if (evtErr) {
        return new Response(JSON.stringify({ error: evtErr.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, id: newUser.user.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
