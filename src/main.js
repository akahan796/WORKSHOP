// App entry: hash router + auth gate.
//   #/                 dashboard (staff)        #/login       sign in / create account
//   #/w/<id>/setup     workshop setup (facilitators)
//   #/w/<id>           live workshop room (any member)
//   #/join/<token>     guest invite link
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client?deps=react@18.3.1';
import { html, useState, useEffect } from './lib.js';
import { backend } from './backend/index.js';
import { AuthView } from './views/auth.js';
import { Dashboard } from './views/dashboard.js';
import { SetupView } from './views/setup.js';
import { JoinView } from './views/join.js';
import { RoomView } from './views/room.js';
import { Header } from './views/ui.js';
import { SummaryView } from './views/summary.js';

console.log('Workshop AI build 2026-10-29-e · backend:', backend.mode);

function useHash() {
  const [hash, setHash] = useState(location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1) || '/');
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
}

function App() {
  const [user, setUser] = useState(backend.session());
  useEffect(() => backend.onAuth(setUser), []);
  const path = useHash();

  let m;
  if ((m = path.match(/^\/join\/([\w-]+)/))) return html`<${JoinView} token=${m[1]} user=${user} />`;
  if ((m = path.match(/^\/w\/([\w-]+)\/summary/))) {
    if (!user) return html`<${Header} user=${user} /><${AuthView} />`;
    return html`<${Header} user=${user} /><${SummaryView} wsId=${m[1]} user=${user} />`;
  }
  if ((m = path.match(/^\/w\/([\w-]+)$/))) {
    if (!user) return html`<${Header} user=${user} /><${AuthView} />`;
    return html`<${RoomView} wsId=${m[1]} user=${user} />`;
  }
  if ((m = path.match(/^\/w\/([\w-]+)\/setup/)) && user) return html`<${Header} user=${user} /><${SetupView} wsId=${m[1]} user=${user} />`;
  if (!user || !user.isStaff) {
    return html`<${Header} user=${user} /><${AuthView} guest=${user && !user.isStaff} />`;
  }
  return html`<${Header} user=${user} /><${Dashboard} user=${user} />`;
}

await backend.init();
createRoot(document.getElementById('root')).render(html`<${App} />`);
