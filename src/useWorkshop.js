// Live workshop data: loads everything for one workshop and refetches the
// affected table whenever the backend reports a change (any user, any tab).
import { useState, useEffect, useCallback } from './lib.js';
import { backend } from './backend/index.js';

export function useWorkshop(wsId, user) {
  const [state, setState] = useState({ loading: true, workshop: null, members: [], research: [], stickies: [], invites: {}, error: null });

  const load = useCallback(async (table) => {
    try {
      const patch = {};
      const all = !table;
      if (all || table === 'workshops') patch.workshop = await backend.getWorkshop(wsId);
      if (all || table === 'members') patch.members = await backend.listMembers(wsId);
      if (all || table === 'research') patch.research = await backend.listResearch(wsId);
      if (all || table === 'stickies') patch.stickies = await backend.listStickies(wsId);
      const ws = patch.workshop || null;
      if ((all || table === 'members') && user && user.isStaff) {
        const w = ws || (await backend.getWorkshop(wsId));
        if (w && w.organizer_id === user.id) patch.invites = await backend.listInvites(wsId);
      }
      setState((s) => ({ ...s, ...patch, loading: false, error: null }));
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e.message }));
    }
  }, [wsId, user && user.id]);

  useEffect(() => {
    load();
    const unsub = backend.subscribe(wsId, (table) => load(table === 'users' ? 'members' : table));
    return unsub;
  }, [load]);

  const me = user ? state.members.find((m) => m.user_id === user.id) || null : null;
  const isOrganizer = !!(state.workshop && user && state.workshop.organizer_id === user.id);
  return { ...state, me, isOrganizer, reload: load };
}
