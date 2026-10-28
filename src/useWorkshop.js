// Live workshop data: loads everything for one workshop and refetches the
// affected table whenever the backend reports a change (any user, any tab).
// Rapid changes trigger overlapping fetches; each table only applies the result
// of its most recent fetch, so a slow older response can't overwrite a newer one.
import { useState, useEffect, useCallback, useRef } from './lib.js';
import { backend } from './backend/index.js';

const TABLES = ['workshops', 'members', 'research', 'stickies', 'votes'];

export function useWorkshop(wsId, user) {
  const [state, setState] = useState({ loading: true, workshop: null, members: [], research: [], stickies: [], votes: [], invites: {}, error: null });
  const seq = useRef({});

  const fetchTable = useCallback(async (table) => {
    const n = (seq.current[table] = (seq.current[table] || 0) + 1);
    const patch = {};
    if (table === 'workshops') patch.workshop = await backend.getWorkshop(wsId);
    if (table === 'members') {
      patch.members = await backend.listMembers(wsId);
      if (user && user.isStaff) {
        const w = await backend.getWorkshop(wsId);
        if (w && w.organizer_id === user.id) patch.invites = await backend.listInvites(wsId);
      }
    }
    if (table === 'research') patch.research = await backend.listResearch(wsId);
    if (table === 'stickies') patch.stickies = await backend.listStickies(wsId);
    if (table === 'votes') patch.votes = await backend.listVotes(wsId);
    if (n === seq.current[table]) setState((s) => ({ ...s, ...patch, loading: false, error: null }));
  }, [wsId, user && user.id]);

  const load = useCallback(async (table) => {
    try { await Promise.all((table ? [table] : TABLES).map(fetchTable)); }
    catch (e) { setState((s) => ({ ...s, loading: false, error: e.message })); }
  }, [fetchTable]);

  useEffect(() => {
    load();
    const unsub = backend.subscribe(wsId, (table) => load(table === 'users' ? 'members' : table));
    return unsub;
  }, [load]);

  const me = user ? state.members.find((m) => m.user_id === user.id) || null : null;
  const isOrganizer = !!(state.workshop && user && state.workshop.organizer_id === user.id);
  return { ...state, me, isOrganizer, reload: load };
}
