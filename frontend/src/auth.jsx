import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import { isNative } from './platform.js';
import { registerPush, unregisterPush } from './push.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [config, setConfig] = useState({ anneeCourante: '', ecoleNom: '' });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try { setConfig(await api('/config')); } catch { /* hors ligne */ }
      if (getToken()) { try { setUser(await api('/auth/me')); if (isNative) registerPush().catch(() => {}); } catch { setToken(null); } }
      setReady(true);
    })();
  }, []);

  const login = async (email, password) => {
    const r = await api('/auth/login', { method: 'POST', body: { email, password } });
    setToken(r.token); setUser(r.user);
    if (isNative) registerPush().catch(() => {});
  };
  const logout = () => { unregisterPush(); setToken(null); setUser(null); }; // le retrait du jeton push part avec le token encore valide
  return <Ctx.Provider value={{ user, config, ready, login, logout }}>{children}</Ctx.Provider>;
}
