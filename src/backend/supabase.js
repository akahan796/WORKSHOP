// Supabase backend. Tables, RLS and RPCs are defined in supabase/schema.sql.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { KEEP_STATE } from '../lib.js';

// Two kinds of client. Staff (organizers) use the default client: session in
// localStorage, shared by all their tabs. A guest tab (opened from an invite link)
// gets its OWN client with a per-tab storage key in sessionStorage. supabase-js
// syncs sessions across tabs that share a storage key, so a shared key would
// let the organizer's session leak into guest tabs (and vice versa).
const GUEST_KEY = 'wai_guest_storage_key';
const urlCache = {}; // sketch path → { url, exp }
const LIVE_TABLES = ['workshops', 'members', 'research', 'prework', 'stickies', 'votes', 'sheets', 'artifacts'];

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

  const localListeners = new Set();
  const api = {
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

    // Admins see every workshop; each one carries its creator's name.
    async listMyWorkshops() {
      const list = ok(await sb.from('workshops').select('*').order('created_at', { ascending: false }));
      const ids = [...new Set(list.map((w) => w.organizer_id))];
      const people = ids.length ? ok(await sb.from('profiles').select('id, name, email').in('id', ids)) : [];
      const name = Object.fromEntries(people.map((p) => [p.id, p.name || p.email]));
      return list.map((w) => ({ ...w, organizer_name: name[w.organizer_id] || '' }));
    },
    async createWorkshop(fields) { return ok(await sb.from('workshops').insert(fields).select().single()); },
    async getWorkshop(id) { return ok(await sb.from('workshops').select('*').eq('id', id).maybeSingle()); },
    async updateWorkshop(id, patch) { return ok(await sb.from('workshops').update(patch).eq('id', id).select().single()); },
    async deleteWorkshop(id) { ok(await sb.from('workshops').delete().eq('id', id)); },
    // Back to a new, unstarted workshop: deletes everything the session produced
    // (stickies, HMWs, votes, sketches, flow, prototypes, decisions) and keeps the
    // setup (details, intro, agenda, people, research decks, AI mode, voting setting).
    async resetWorkshop(id) {
      const { data: sheets } = await sb.from('sheets').select('cells').eq('workshop_id', id);
      const paths = (sheets || []).flatMap((x) => (x.cells || []).map((c) => c.file_path)).filter(Boolean);
      if (paths.length) await sb.storage.from('sketches').remove(paths);
      for (const t of ['votes', 'stickies', 'sheets', 'artifacts']) ok(await sb.from(t).delete().eq('workshop_id', id));
      const w = ok(await sb.from('workshops').select('step_state').eq('id', id).single());
      const keep = Object.fromEntries(Object.entries(w.step_state || {}).filter(([k]) => KEEP_STATE.includes(k)));
      ok(await sb.from('workshops').update({ status: 'draft', current_step: 'cover', timer_ends_at: null, step_state: keep }).eq('id', id));
    },
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

    // Pre-work documents: a row per document; file_path stays null until someone uploads it.
    async listPrework(wsId) { return ok(await sb.from('prework').select('*').eq('workshop_id', wsId).order('created_at')); },
    async addPrework(wsId, fields) { return ok(await sb.from('prework').insert({ ...fields, workshop_id: wsId }).select().single()); },
    async updatePrework(id, patch) { return ok(await sb.from('prework').update(patch).eq('id', id).select().single()); },
    async deletePrework(item) {
      if (item.file_path) await sb.storage.from('prework').remove([item.file_path]);
      ok(await sb.from('prework').delete().eq('id', item.id));
    },
    // Facilitators and the person a document was requested from can upload (submit_prework checks).
    async uploadPrework(item, file) {
      const path = `${item.workshop_id}/${item.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, '_')}`;
      ok(await sb.storage.from('prework').upload(path, file, { contentType: file.type || undefined }));
      ok(await sb.rpc('submit_prework', { p_id: item.id, p_path: path, p_name: file.name, p_size: file.size }));
      if (item.file_path) await sb.storage.from('prework').remove([item.file_path]); // only facilitators may; harmless otherwise
    },
    async removePreworkFile(item) {
      if (item.file_path) await sb.storage.from('prework').remove([item.file_path]);
      return ok(await sb.from('prework').update({ file_path: null, file_name: null, file_size: null, uploaded_by: null, uploaded_at: null }).eq('id', item.id).select().single());
    },
    async preworkFileUrl(item) {
      const data = ok(await sb.storage.from('prework').createSignedUrl(item.file_path, 60 * 60, { download: item.file_name || true }));
      return data.signedUrl;
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

    async listSheets(wsId) {
      const { data, error } = await sb.from('sheets').select('*').eq('workshop_id', wsId);
      if (error) { console.warn('sheets unavailable (run supabase/migrations/003_phase3.sql):', error.message); return []; }
      return data;
    },
    async saveSheet(wsId, memberId, kind, patch) {
      return ok(await sb.from('sheets').upsert(
        { workshop_id: wsId, member_id: memberId, kind, ...patch, updated_at: new Date().toISOString() },
        { onConflict: 'workshop_id,member_id,kind' }).select().single());
    },
    async listArtifacts(wsId) {
      const { data, error } = await sb.from('artifacts').select('*').eq('workshop_id', wsId).order('version');
      if (error) { console.warn('artifacts unavailable (run supabase/migrations/004_phase4.sql):', error.message); return []; }
      return data;
    },
    async saveArtifact(wsId, kind, version, patch) {
      return ok(await sb.from('artifacts').upsert(
        { workshop_id: wsId, kind, version, ...patch, updated_at: new Date().toISOString() },
        { onConflict: 'workshop_id,kind,version' }).select().single());
    },
    async uploadSketch(wsId, memberId, blob, ext) {
      const path = `${wsId}/${memberId}/${crypto.randomUUID()}.${ext}`;
      ok(await sb.storage.from('sketches').upload(path, blob, { contentType: blob.type || undefined }));
      return path;
    },
    // Signed URLs, cached until shortly before they expire.
    async sketchUrls(paths) {
      const now = Date.now(), out = {}, need = [];
      for (const p of paths) { const c = urlCache[p]; if (c && c.exp > now) out[p] = c.url; else need.push(p); }
      if (need.length) {
        const data = ok(await sb.storage.from('sketches').createSignedUrls(need, 60 * 60 * 8));
        for (const d of data) if (d.signedUrl) { urlCache[d.path] = { url: d.signedUrl, exp: now + 7.5 * 3600e3 }; out[d.path] = d.signedUrl; }
      }
      return out;
    },

    // Claude calls run in the `ai` edge function (supabase/functions/ai) with the organizer's session.
    async ai(task, body) {
      const { data, error } = await sb.functions.invoke('ai', { body: { task, ...body } });
      if (error) {
        let msg = error.message;
        try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch {}
        if (/^Unknown task/.test(msg)) msg = 'The deployed AI function is out of date. In Supabase → Edge Functions → ai, paste the latest supabase/functions/ai/index.ts and deploy.';
        else if (/Failed to send|404|not found/i.test(msg)) msg = 'The AI service isn\'t set up yet: deploy the "ai" edge function and add the ANTHROPIC_API_KEY secret (see README).';
        throw new Error(msg);
      }
      return data;
    },

    // Live updates. Three sources, so a screen never goes stale:
    //  1. realtime changes from other people (a fresh channel per subscription:
    //     reusing a topic while the previous channel is still closing drops events),
    //  2. this tab's own writes, applied immediately (see the wrapper below),
    //  3. a fallback refresh when the tab regains focus and every 20 seconds.
    subscribe(wsId, fn) {
      const ch = sb.channel(`ws-${wsId}-${crypto.randomUUID()}`);
      for (const table of LIVE_TABLES) {
        const filter = table === 'workshops' ? `id=eq.${wsId}` : `workshop_id=eq.${wsId}`;
        ch.on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => fn(table));
      }
      ch.subscribe();
      const local = (table) => fn(table);
      localListeners.add(local);
      const refreshAll = () => LIVE_TABLES.forEach((t) => fn(t));
      const onVisible = () => document.visibilityState === 'visible' && refreshAll();
      document.addEventListener('visibilitychange', onVisible);
      const timer = setInterval(() => document.visibilityState === 'visible' && refreshAll(), 20000);
      return () => {
        sb.removeChannel(ch);
        localListeners.delete(local);
        document.removeEventListener('visibilitychange', onVisible);
        clearInterval(timer);
      };
    },
  };

  // Writes notify this tab's subscribers right away, without waiting for realtime.
  const WRITES = {
    updateWorkshop: ['workshops'], setStepState: ['workshops'], setDecision: ['workshops'],
    addMember: ['members'], updateMember: ['members'], removeMember: ['members', 'stickies', 'votes', 'sheets', 'prework'], claimInvite: ['members'],
    uploadResearch: ['research'], deleteResearch: ['research'],
    addPrework: ['prework'], updatePrework: ['prework'], deletePrework: ['prework'], uploadPrework: ['prework'], removePreworkFile: ['prework'],
    addSticky: ['stickies'], updateSticky: ['stickies'], deleteSticky: ['stickies', 'votes'],
    resetWorkshop: ['workshops', 'stickies', 'votes', 'sheets', 'artifacts'],
    addVotes: ['votes'], deleteVote: ['votes'], deleteVotes: ['votes'], saveSheet: ['sheets'], saveArtifact: ['artifacts'],
  };
  for (const [name, tables] of Object.entries(WRITES)) {
    const write = api[name];
    api[name] = async (...args) => {
      const result = await write.apply(api, args);
      tables.forEach((t) => localListeners.forEach((fn) => fn(t)));
      return result;
    };
  }
  return api;
}
