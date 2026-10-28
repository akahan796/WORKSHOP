// Supabase backend. Tables, RLS and RPCs are defined in supabase/schema.sql.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// Two kinds of client. Staff (organizers) use the default client: session in
// localStorage, shared by all their tabs. A guest tab (opened from an invite link)
// gets its OWN client with a per-tab storage key in sessionStorage. supabase-js
// syncs sessions across tabs that share a storage key, so a shared key would
// let the organizer's session leak into guest tabs (and vice versa).
const GUEST_KEY = 'wai_guest_storage_key';

export function createSupabaseBackend({ supabaseUrl, supabaseAnonKey }) {
  let user = null;
  let sb = null;
  let unsubAuth = null;
  const authListeners = new Set();

  const toUser = (u) => (u ? { id: u.id, email: u.email || '', name: u.user_metadata?.name || '', isStaff: !u.is_anonymous } : null);
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

  function useClient(guest) {
    if (unsubAuth) unsubAuth();
    if (guest) {
      let key = sessionStorage.getItem(GUEST_KEY);
      if (!key) { key = 'wai-guest-' + crypto.randomUUID(); sessionStorage.setItem(GUEST_KEY, key); }
      sb = createClient(supabaseUrl, supabaseAnonKey, { auth: { storage: sessionStorage, storageKey: key } });
    } else {
      sessionStorage.removeItem(GUEST_KEY);
      sb = createClient(supabaseUrl, supabaseAnonKey);
    }
    const { data } = sb.auth.onAuthStateChange((_e, session) => {
      user = toUser(session?.user);
      authListeners.forEach((fn) => fn(user));
    });
    unsubAuth = () => data.subscription.unsubscribe();
  }
  useClient(!!sessionStorage.getItem(GUEST_KEY));

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
    async signOut() {
      const guest = !!sessionStorage.getItem(GUEST_KEY);
      await sb.auth.signOut({ scope: 'local' });
      if (guest) { useClient(false); await this.init(); authListeners.forEach((fn) => fn(user)); }
    },

    async listMyWorkshops() {
      return ok(await sb.from('workshops').select('*').order('created_at', { ascending: false }));
    },
    async createWorkshop(fields) { return ok(await sb.from('workshops').insert(fields).select().single()); },
    async getWorkshop(id) { return ok(await sb.from('workshops').select('*').eq('id', id).maybeSingle()); },
    async updateWorkshop(id, patch) { return ok(await sb.from('workshops').update(patch).eq('id', id).select().single()); },
    async deleteWorkshop(id) { ok(await sb.from('workshops').delete().eq('id', id)); },
    async setStepState(id, patch) { ok(await sb.rpc('set_step_state', { ws: id, patch })); },
    async setDecision(id, key, value) { ok(await sb.rpc('set_decision', { ws: id, p_key: key, p_value: value })); },

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
      // This tab becomes a guest tab with its own session; a staff session in
      // other tabs is left untouched.
      if (!user || user.isStaff) {
        useClient(true);
        ok(await sb.auth.signInAnonymously({ options: { data: { name: name.trim() } } }));
      }
      const wsId = ok(await sb.rpc('claim_invite', { p_token: tok, p_name: name, p_discipline: discipline || '' }));
      if (user && user.name !== name.trim()) ok(await sb.auth.updateUser({ data: { name: name.trim() } }));
      return wsId;
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
    async deleteSticky(id) {
      ok(await sb.from('votes').delete().eq('target_id', id));
      ok(await sb.from('stickies').delete().eq('id', id));
    },

    async listVotes(wsId) {
      const { data, error } = await sb.from('votes').select('*').eq('workshop_id', wsId);
      if (error) { console.warn('votes unavailable (run supabase/migrations/002_phase2.sql):', error.message); return []; }
      return data;
    },
    async addVotes(rows) { return ok(await sb.from('votes').insert(rows).select()); },
    async deleteVote(id) { ok(await sb.from('votes').delete().eq('id', id)); },
    async deleteVotes(wsId, round, memberIds) {
      let q = sb.from('votes').delete().eq('workshop_id', wsId).eq('round', round);
      if (memberIds) q = q.in('member_id', memberIds);
      ok(await q);
    },

    // Claude calls run in the `ai` edge function (supabase/functions/ai) with the organizer's session.
    async ai(task, body) {
      const { data, error } = await sb.functions.invoke('ai', { body: { task, ...body } });
      if (error) {
        let msg = error.message;
        try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch {}
        if (/Failed to send|404|not found/i.test(msg)) msg = 'The AI service isn\'t set up yet: deploy the "ai" edge function and add the ANTHROPIC_API_KEY secret (see README).';
        throw new Error(msg);
      }
      return data;
    },

    subscribe(wsId, fn) {
      const ch = sb.channel('ws-' + wsId);
      for (const table of ['workshops', 'members', 'research', 'stickies', 'votes']) {
        const filter = table === 'workshops' ? `id=eq.${wsId}` : `workshop_id=eq.${wsId}`;
        ch.on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => fn(table));
      }
      ch.subscribe();
      return () => sb.removeChannel(ch);
    },
  };
}
