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

  const open = (r) => { setToken(r.token); setUser(r.user); if (isNative) registerPush().catch(() => {}); };
  const login = async (email, password) => open(await api('/auth/login', { method: 'POST', body: { email, password } }));
  // Connexion de démonstration : le serveur ouvre la session d'un vrai compte enregistré (aucun identifiant ni mot de passe côté navigateur)
  const loginDemo = async (groupe, role) => open(await api('/demo/login', { method: 'POST', body: { groupe, role } }));
  // Relit le profil (après changement du mot de passe temporaire, ou modification du profil)
  const refresh = async () => { const me = await api('/auth/me'); setUser(me); return me; };
  const logout = () => { unregisterPush(); setToken(null); setUser(null); }; // le retrait du jeton push part avec le token encore valide
  return <Ctx.Provider value={{ user, config, ready, login, loginDemo, refresh, logout }}>{children}</Ctx.Provider>;
}
