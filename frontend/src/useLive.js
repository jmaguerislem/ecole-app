import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

// Données d'un écran de statistiques, lues en base à chaque appel et actualisées automatiquement :
// à l'ouverture, quand `path` change (filtres), après CHAQUE modification faite dans l'application (événement émis par api()),
// à intervalle régulier (modifications faites par d'autres comptes) et au retour sur l'onglet.
export function useLive(path, { interval = 15000 } = {}) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [maj, setMaj] = useState(null);
  const seq = useRef(0); const timer = useRef();
  const load = useCallback(async () => {
    if (!path) return; // `path` nul : rien à lire (ex. filtre inactif)
    const n = ++seq.current; // seule la réponse de la dernière requête est gardée (filtres changés rapidement)
    try { const d = await api(path); if (n === seq.current) { setData(d); setErr(''); setMaj(new Date()); } }
    catch (e) { if (n === seq.current) setErr(e.message); }
  }, [path]);
  useEffect(() => {
    load();
    const onChange = () => { clearTimeout(timer.current); timer.current = setTimeout(load, 300); };
    const onVis = () => document.visibilityState === 'visible' && load();
    const iv = setInterval(() => document.visibilityState === 'visible' && load(), interval);
    window.addEventListener('data:changed', onChange); document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); clearTimeout(timer.current); window.removeEventListener('data:changed', onChange); document.removeEventListener('visibilitychange', onVis); };
  }, [load, interval]);
  return { data, err, maj, reload: load };
}
