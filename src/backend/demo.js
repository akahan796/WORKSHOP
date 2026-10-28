// Demo backend: same API as the Supabase backend, stored in this browser.
// Tables live in localStorage, uploaded PDFs in IndexedDB, and every write is
// broadcast so other tabs (other "people") update live. The signed-in user is
// per tab (sessionStorage), so one browser can play organizer, researcher and
// participants side by side.
import { uid, token } from '../lib.js';

const DB_KEY = 'wai_demo_db';
const SESSION_KEY = 'wai_demo_session';
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('wai_demo') : null;
const listeners = new Set();
const authListeners = new Set();

const empty = () => ({ users: [], workshops: [], members: [], invites: [], research: [], stickies: [] });
const load = () => { try { return { ...empty(), ...JSON.parse(localStorage.getItem(DB_KEY) || '{}') }; } catch { return empty(); } };
const now = () => new Date().toISOString();

function write(mutator, table) {
  const db = load();
  const result = mutator(db);
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  emit(table);
  return result;
}
function emit(table) {
  listeners.forEach((fn) => fn(table));
  if (channel) channel.postMessage({ table });
}
if (channel) channel.onmessage = (e) => listeners.forEach((fn) => fn(e.data.table));

// ── IndexedDB for files ──
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('wai_demo_files', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function putFile(path, blob) {
  const db = await idb();
  return new Promise((res, rej) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(blob, path); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
async function getFile(path) {
  const db = await idb();
  return new Promise((res, rej) => { const r = db.transaction('files').objectStore('files').get(path); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

function currentUser() {
  const id = sessionStorage.getItem(SESSION_KEY);
  if (!id) return null;
  const u = load().users.find((x) => x.id === id);
  return u ? { id: u.id, email: u.email, name: u.name, isStaff: !!u.isStaff } : null;
}
function setSession(id) {
  if (id) sessionStorage.setItem(SESSION_KEY, id); else sessionStorage.removeItem(SESSION_KEY);
  authListeners.forEach((fn) => fn(currentUser()));
}
function requireUser() { const u = currentUser(); if (!u) throw new Error('Not signed in'); return u; }

export function createDemoBackend() {
  return {
    mode: 'demo',
    async init() {},
    session: currentUser,
    onAuth(fn) { authListeners.add(fn); return () => authListeners.delete(fn); },

    async signUp({ name, email, password }) {
      email = email.trim().toLowerCase();
      const id = write((db) => {
        if (db.users.some((u) => u.email === email)) throw new Error('An account with that email already exists.');
        const u = { id: uid(), email, name: name.trim(), password, isStaff: true };
        db.users.push(u);
        return u.id;
      }, 'users');
      setSession(id);
    },
    async signIn({ email, password }) {
      const u = load().users.find((x) => x.isStaff && x.email === email.trim().toLowerCase() && x.password === password);
      if (!u) throw new Error('Wrong email or password.');
      setSession(u.id);
    },
    async signOut() { setSession(null); },

    async listMyWorkshops() {
      const me = requireUser();
      const db = load();
      const mine = new Set(db.members.filter((m) => m.user_id === me.id).map((m) => m.workshop_id));
      return db.workshops.filter((w) => w.organizer_id === me.id || mine.has(w.id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async createWorkshop(fields) {
      const me = requireUser();
      return write((db) => {
        const w = { id: uid(), organizer_id: me.id, title: 'Untitled workshop', project: '', description: '', starts_at: null,
          intro: {}, agenda: [], status: 'draft', current_step: 'intro', step_state: {}, timer_ends_at: null, created_at: now(), ...fields };
        db.workshops.push(w);
        const m = { id: uid(), workshop_id: w.id, user_id: me.id, name: me.name, email: me.email, role: 'organizer',
          discipline: null, color: '#CFE0FF', is_decider: false, is_synthetic: false, joined_at: now(), created_at: now() };
        db.members.push(m);
        db.invites.push({ token: token(), member_id: m.id, workshop_id: w.id });
        return w;
      }, 'workshops');
    },
    async getWorkshop(id) { return load().workshops.find((w) => w.id === id) || null; },
    async updateWorkshop(id, patch) {
      return write((db) => { const w = db.workshops.find((x) => x.id === id); Object.assign(w, patch); return w; }, 'workshops');
    },
    async deleteWorkshop(id) {
      write((db) => {
        db.workshops = db.workshops.filter((w) => w.id !== id);
        for (const t of ['members', 'invites', 'research', 'stickies']) db[t] = db[t].filter((r) => r.workshop_id !== id);
      }, 'workshops');
    },
    async setStepState(id, patch) {
      write((db) => { const w = db.workshops.find((x) => x.id === id); w.step_state = { ...w.step_state, ...patch }; }, 'workshops');
    },

    async listMembers(wsId) {
      return load().members.filter((m) => m.workshop_id === wsId).sort((a, b) => a.created_at.localeCompare(b.created_at));
    },
    async addMember(wsId, fields) {
      return write((db) => {
        const m = { id: uid(), workshop_id: wsId, user_id: null, name: '', email: '', role: 'participant', discipline: null,
          color: '#FFE27A', is_decider: false, is_synthetic: false, joined_at: null, created_at: now(), ...fields };
        db.members.push(m);
        db.invites.push({ token: token(), member_id: m.id, workshop_id: wsId });
        return m;
      }, 'members');
    },
    async updateMember(id, patch) {
      return write((db) => {
        const m = db.members.find((x) => x.id === id);
        if (patch.is_decider) db.members.forEach((o) => { if (o.workshop_id === m.workshop_id) o.is_decider = false; });
        Object.assign(m, patch);
        return m;
      }, 'members');
    },
    async removeMember(id) {
      write((db) => {
        db.members = db.members.filter((m) => m.id !== id);
        db.invites = db.invites.filter((i) => i.member_id !== id);
        db.stickies = db.stickies.filter((s) => s.member_id !== id);
      }, 'members');
    },
    async listInvites(wsId) {
      return Object.fromEntries(load().invites.filter((i) => i.workshop_id === wsId).map((i) => [i.member_id, i.token]));
    },
    async peekInvite(tok) {
      const db = load();
      const inv = db.invites.find((i) => i.token === tok);
      if (!inv) return null;
      const m = db.members.find((x) => x.id === inv.member_id);
      const w = db.workshops.find((x) => x.id === inv.workshop_id);
      return m && w ? { workshop_title: w.title, member_name: m.name, member_role: m.role, member_discipline: m.discipline } : null;
    },
    async claimInvite(tok, name, discipline) {
      // Guest link = anonymous sign-in, then bind this tab's user to the member.
      let me = currentUser();
      if (!me || me.isStaff) {
        const id = write((db) => { const u = { id: uid(), email: '', name, isStaff: false }; db.users.push(u); return u.id; }, 'users');
        sessionStorage.setItem(SESSION_KEY, id);
        me = currentUser();
      }
      const wsId = write((db) => {
        const inv = db.invites.find((i) => i.token === tok);
        if (!inv) throw new Error('This invite link is not valid.');
        const m = db.members.find((x) => x.id === inv.member_id);
        m.user_id = me.id;
        if (name.trim()) m.name = name.trim();
        if (m.role === 'participant' && discipline) m.discipline = discipline;
        m.joined_at = m.joined_at || now();
        const u = db.users.find((x) => x.id === me.id); u.name = m.name;
        return inv.workshop_id;
      }, 'members');
      authListeners.forEach((fn) => fn(currentUser()));
      return wsId;
    },

    async listResearch(wsId) {
      return load().research.filter((r) => r.workshop_id === wsId).sort((a, b) => a.created_at.localeCompare(b.created_at));
    },
    async uploadResearch(wsId, file, title, memberId) {
      const id = uid();
      const path = `${wsId}/${id}.pdf`;
      await putFile(path, file);
      return write((db) => {
        const r = { id, workshop_id: wsId, member_id: memberId, title: title || file.name.replace(/\.pdf$/i, ''), file_path: path, created_at: now() };
        db.research.push(r);
        return r;
      }, 'research');
    },
    async researchFileUrl(item) {
      const blob = await getFile(item.file_path);
      return blob ? URL.createObjectURL(blob) : null;
    },
    async deleteResearch(item) { write((db) => { db.research = db.research.filter((r) => r.id !== item.id); }, 'research'); },

    async listStickies(wsId) {
      return load().stickies.filter((s) => s.workshop_id === wsId).sort((a, b) => a.created_at.localeCompare(b.created_at));
    },
    async addSticky(fields) {
      return write((db) => { const s = { id: uid(), data: {}, created_at: now(), ...fields }; db.stickies.push(s); return s; }, 'stickies');
    },
    async updateSticky(id, patch) {
      return write((db) => { const s = db.stickies.find((x) => x.id === id); Object.assign(s, patch); return s; }, 'stickies');
    },
    async deleteSticky(id) { write((db) => { db.stickies = db.stickies.filter((s) => s.id !== id); }, 'stickies'); },

    subscribe(wsId, fn) {
      const handler = (table) => fn(table);
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
  };
}
