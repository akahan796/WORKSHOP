// Supabase backend. Tables, RLS and RPCs are defined in supabase/schema.sql.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

export function createSupabaseBackend({ supabaseUrl, supabaseAnonKey }) {
  const sb = createClient(supabaseUrl, supabaseAnonKey);
  let user = null;
  const authListeners = new Set();

  const toUser = (u) => (u ? { id: u.id, email: u.email || '', name: u.user_metadata?.name || '', isStaff: !u.is_anonymous } : null);
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

  sb.auth.onAuthStateChange((_e, session) => {
    user = toUser(session?.user);
    authListeners.forEach((fn) => fn(user));
  });

  return {
    mode: 'supabase',
    async init() { const { data } = await sb.auth.getSession(); user = toUser(data.session?.user); },
    session: () => user,
    onAuth(fn) { authListeners.add(fn); return () => authListeners.delete(fn); },

    async signUp({ name, email, password }) {
      const data = ok(await sb.auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim() } } }));
      if (!data.session) throw new Error('Check your email to confirm your account, then sign in.');
    },
    async signIn({ email, password }) { ok(await sb.auth.signInWithPassword({ email: email.trim(), password })); },
    async signOut() { await sb.auth.signOut(); },

    async listMyWorkshops() {
      return ok(await sb.from('workshops').select('*').order('created_at', { ascending: false }));
    },
    async createWorkshop(fields) { return ok(await sb.from('workshops').insert(fields).select().single()); },
    async getWorkshop(id) { return ok(await sb.from('workshops').select('*').eq('id', id).maybeSingle()); },
    async updateWorkshop(id, patch) { return ok(await sb.from('workshops').update(patch).eq('id', id).select().single()); },
    async deleteWorkshop(id) { ok(await sb.from('workshops').delete().eq('id', id)); },
    async setStepState(id, patch) { ok(await sb.rpc('set_step_state', { ws: id, patch })); },

    async listMembers(wsId) { return ok(await sb.from('members').select('*').eq('workshop_id', wsId).order('created_at')); },
    async addMember(wsId, fields) { return ok(await sb.from('members').insert({ ...fields, workshop_id: wsId }).select().single()); },
    async updateMember(id, patch) {
      if (patch.is_decider) {
        const m = ok(await sb.from('members').select('workshop_id').eq('id', id).single());
        ok(await sb.from('members').update({ is_decider: false }).eq('workshop_id', m.workshop_id));
      }
      return ok(await sb.from('members').update(patch).eq('id', id).select().single());
    },
    async removeMember(id) { ok(await sb.from('members').delete().eq('id', id)); },
    async listInvites(wsId) {
      const rows = ok(await sb.from('invites').select('member_id, token').eq('workshop_id', wsId));
      return Object.fromEntries(rows.map((r) => [r.member_id, r.token]));
    },
    async peekInvite(tok) {
      const rows = ok(await sb.rpc('peek_invite', { p_token: tok }));
      return rows && rows[0] ? rows[0] : null;
    },
    async claimInvite(tok, name, discipline) {
      if (!user || user.isStaff) {
        if (user) await sb.auth.signOut();
        ok(await sb.auth.signInAnonymously());
      }
      return ok(await sb.rpc('claim_invite', { p_token: tok, p_name: name, p_discipline: discipline || '' }));
    },

    async listResearch(wsId) { return ok(await sb.from('research').select('*').eq('workshop_id', wsId).order('created_at')); },
    async uploadResearch(wsId, file, title, memberId) {
      const path = `${wsId}/${crypto.randomUUID()}.pdf`;
      ok(await sb.storage.from('research').upload(path, file, { contentType: 'application/pdf' }));
      return ok(await sb.from('research').insert({ workshop_id: wsId, member_id: memberId, title: title || file.name.replace(/\.pdf$/i, ''), file_path: path }).select().single());
    },
    async researchFileUrl(item) {
      const data = ok(await sb.storage.from('research').createSignedUrl(item.file_path, 60 * 60 * 8));
      return data.signedUrl;
    },
    async deleteResearch(item) {
      await sb.storage.from('research').remove([item.file_path]);
      ok(await sb.from('research').delete().eq('id', item.id));
    },

    async listStickies(wsId) { return ok(await sb.from('stickies').select('*').eq('workshop_id', wsId).order('created_at')); },
    async addSticky(fields) { return ok(await sb.from('stickies').insert(fields).select().single()); },
    async updateSticky(id, patch) { return ok(await sb.from('stickies').update(patch).eq('id', id).select().single()); },
    async deleteSticky(id) { ok(await sb.from('stickies').delete().eq('id', id)); },

    subscribe(wsId, fn) {
      const ch = sb.channel('ws-' + wsId);
      for (const table of ['workshops', 'members', 'research', 'stickies']) {
        const filter = table === 'workshops' ? `id=eq.${wsId}` : `workshop_id=eq.${wsId}`;
        ch.on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => fn(table));
      }
      ch.subscribe();
      return () => sb.removeChannel(ch);
    },
  };
}
