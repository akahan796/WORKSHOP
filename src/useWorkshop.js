// Live workshop data: loads everything for one workshop and refetches the
// affected table whenever the backend reports a change (any user, any tab).
// Rapid changes trigger overlapping fetches; each table only applies the result
// of its most recent fetch, so a slow older response can't overwrite a newer one.
import { useState, useEffect, useCallback, useRef } from './lib.js';
import { backend } from './backend/index.js';

const TABLES = ['workshops', 'members', 'research', 'stickies', 'votes', 'sheets', 'artifacts'];

export function useWorkshop(wsId, user) {
  const [state, setState] = useState({ loading: true, workshop: null, members: [], research: [], stickies: [], votes: [], sheets: [], artifacts: [], invites: {}, error: null });
  const seq = useRef({});

  const fetchTable = useCallback(async (table) => {
    const n = (seq.current[table] = (seq.current[table] || 0) + 1);
    const patch = {};
    if (table === 'workshops') patch.workshop = await backend.getWorkshop(wsId);
    if (table === 'members') {
      patch.members = await backend.listMembers(wsId);
      if (user) {
        const w = await backend.getWorkshop(wsId);
        const mine = patch.members.find((m) => m.user_id === user.id);
        if (w && (user.isStaff || w.organizer_id === user.id || mine?.role === 'facilitator')) patch.invites = await backend.listInvites(wsId);
      }
    }
    if (table === 'research') patch.research = await backend.listResearch(wsId);
    if (table === 'stickies') patch.stickies = await backend.listStickies(wsId);
    if (table === 'votes') patch.votes = await backend.listVotes(wsId);
    if (table === 'sheets') patch.sheets = await backend.listSheets(wsId);
    if (table === 'artifacts') patch.artifacts = await backend.listArtifacts(wsId);
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
  // isOwner: created the workshop. isOrganizer: may run it (any admin, or a guest facilitator).
  const isOwner = !!(state.workshop && user && state.workshop.organizer_id === user.id);
  const isOrganizer = isOwner || !!user?.isStaff || me?.role === 'facilitator';
  return { ...state, me, isOwner, isOrganizer, reload: load };
}
