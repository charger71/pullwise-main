// Staff accounts for Admin → Staff. Owners only (checked with public.is_owner() as the caller).
//
// POST (Authorization: the owner's session)
//   { "action": "add", "name", "email", "password"? }   creates the login (auto-confirmed) and the staff row;
//                                                        a blank password generates one. Returns { password } once.
//   { "action": "reset_password", "user_id", "password"? }  sets a new password (blank = generate), returns it once
//   { "action": "set_owner", "user_id", "is_owner" }
//   { "action": "remove", "user_id" }                    takes them off the staff list and deletes their login
//   A Super Admin (staff.is_super) can't be removed or demoted, and only a Super Admin can reset their password.
//                                                        (unless the same login is also a customer's)
//
// Deploy with:  supabase functions deploy staff-admin

import { createClient } from 'npm:@supabase/supabase-js@2';
import { generatePassword, checkNewStaff, checkChange } from './rules.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const auth = req.headers.get('authorization');
  if (!auth) return json(401, { error: 'Not signed in.' });
  const caller = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: isOwner } = await caller.rpc('is_owner');
  if (isOwner !== true) return json(403, { error: 'Only an owner can manage staff.' });
  const actorId = (await caller.auth.getUser()).data.user?.id;
  if (!actorId) return json(401, { error: 'Not signed in.' });

  const actorName = (await admin.from('staff').select('name').eq('user_id', actorId).maybeSingle()).data?.name ?? null;
  // One entry in the change log (Admin → Staff → Change log). Never stops the action itself.
  const audit = async (action: 'insert' | 'update' | 'delete', label: string, changed?: Record<string, unknown>) => {
    const { error } = await admin.from('staff_audit').insert({
      user_id: actorId, staff_name: actorName, table_name: 'staff', action,
      summary: [{ label, ...(changed ? { changed } : {}) }],
    });
    if (error) console.error('staff_audit', error.message);
  };

  const body = await req.json().catch(() => ({}));
  try {
    const { data: staff, error } = await admin.from('staff').select('user_id,is_owner,is_super,name');
    if (error) throw error;

    if (body.action === 'add') {
      const c = checkNewStaff(body);
      if (c.error) return json(400, { error: c.error });
      const password = String(body.password ?? '') || generatePassword();
      const { data, error: cErr } = await admin.auth.admin.createUser({ email: c.email, password, email_confirm: true });
      if (cErr) {
        const exists = /already|registered|exists/i.test(cErr.message);
        return json(exists ? 409 : 400, { error: exists ? 'That email already has an account (maybe as a customer). Use a different email for the staff login.' : cErr.message });
      }
      const { error: sErr } = await admin.from('staff').insert({ user_id: data.user!.id, name: c.name, is_owner: false });
      if (sErr) {
        await admin.auth.admin.deleteUser(data.user!.id); // don't leave a login with no staff row
        throw sErr;
      }
      await audit('insert', c.email);
      return json(200, { ok: true, email: c.email, password });
    }

    const targetId = String(body.user_id ?? '');
    const check = checkChange({ action: body.action, actorId, targetId, staff, makeOwner: body.is_owner === true });
    if (check.error) return json(400, { error: check.error });

    if (body.action === 'reset_password') {
      const password = String(body.password ?? '') || generatePassword();
      if (password.length < 10) return json(400, { error: 'A password needs at least 10 characters. Leave it blank to generate one.' });
      const { error: uErr } = await admin.auth.admin.updateUserById(targetId, { password });
      if (uErr) throw uErr;
      await audit('update', String(staff.find((s) => s.user_id === targetId)?.name ?? targetId), { password: 'reset' });
      return json(200, { ok: true, password });
    }
    if (body.action === 'set_owner') {
      const { error: uErr } = await admin.from('staff').update({ is_owner: body.is_owner === true }).eq('user_id', targetId);
      if (uErr) throw uErr;
      await audit('update', String(staff.find((s) => s.user_id === targetId)?.name ?? targetId), { is_owner: body.is_owner === true });
      return json(200, { ok: true });
    }
    if (body.action === 'remove') {
      const { error: dErr } = await admin.from('staff').delete().eq('user_id', targetId);
      if (dErr) throw dErr;
      // Delete the sign-in too, unless the same login is also a customer's (they keep that).
      const { count } = await admin.from('customers').select('id', { count: 'exact', head: true }).eq('user_id', targetId);
      if (!count) {
        const { error: xErr } = await admin.auth.admin.deleteUser(targetId);
        if (xErr) console.error('delete login', xErr.message);
      }
      await audit('delete', String(staff.find((s) => s.user_id === targetId)?.name ?? targetId));
      return json(200, { ok: true });
    }
    return json(400, { error: 'Unknown action.' });
  } catch (err) {
    console.error(err);
    return json(500, { error: err instanceof Error ? err.message : String(err) });
  }
});
