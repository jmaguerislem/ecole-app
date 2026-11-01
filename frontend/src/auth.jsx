import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [config, setConfig] = useState({ anneeCourante: '', ecoleNom: '' });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try { setConfig(await api('/config')); } catch { /* hors ligne */ }
      if (getToken()) { try { setUser(await api('/auth/me')); } catch { setToken(null); } }
      setReady(true);
    })();
  }, []);

  const login = async (email, password) => {
    const r = await api('/auth/login', { method: 'POST', body: { email, password } });
    setToken(r.token); setUser(r.user);
  };
  const logout = () => { setToken(null); setUser(null); };
  return <Ctx.Provider value={{ user, config, ready, login, logout }}>{children}</Ctx.Provider>;
}
