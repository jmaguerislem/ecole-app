import { Preferences } from '@capacitor/preferences';
import { isNative, apiUrl } from './platform.js';

const BASE = '/api';
// Le token reste lisible de façon synchrone (cache mémoire). Dans l'application native il est aussi
// conservé dans Preferences (stockage natif, non purgé par le système comme le localStorage de la webview).
let cache = null;
export const getToken = () => cache ?? localStorage.getItem('token');
export const setToken = (t) => {
  cache = t || null;
  if (t) localStorage.setItem('token', t); else localStorage.removeItem('token');
  if (isNative) (t ? Preferences.set({ key: 'token', value: t }) : Preferences.remove({ key: 'token' })).catch(() => {});
};
// À appeler une fois avant le premier rendu (main.jsx)
export async function initToken() {
  if (!isNative) return;
  try { const { value } = await Preferences.get({ key: 'token' }); if (value) { cache = value; localStorage.setItem('token', value); } } catch { /* ignore */ }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(apiUrl(BASE + path), { method, headers, body: payload });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && t) { setToken(null); window.location.href = '/login'; }
    throw Object.assign(new Error(data?.error || `Erreur ${res.status}`), { status: res.status, data });
  }
  if (method !== 'GET') window.dispatchEvent(new Event('data:changed')); // les statistiques affichées se rafraîchissent après chaque modification
  return data;
}

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

// Téléchargement/ouverture d'un fichier protégé (JWT dans l'en-tête)
export async function download(path, filename, open = false) {
  const res = await fetch(apiUrl(BASE + path), { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error('Téléchargement impossible');
  const blob = await res.blob();
  if (isNative) {
    // Webview : pas de clic sur <a download> ni de window.open(blob:) → fichier temporaire + feuille de partage (enregistrer, ouvrir, envoyer…)
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const safe = (filename || 'fichier').replace(/[^\w.\-]+/g, '_');
    const { uri } = await Filesystem.writeFile({ path: safe, data: await blobToBase64(blob), directory: Directory.Cache });
    await Share.share({ title: safe, url: uri, dialogTitle: safe });
    return;
  }
  const url = URL.createObjectURL(blob);
  if (open) window.open(url, '_blank');
  else { const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const money = (n) => `${Number(n || 0).toFixed(2)} TND`;
export const ROLES = { admin: 'Administrateur', enseignant: 'Enseignant', parent: 'Parent', eleve: 'Élève', comptable: 'Comptable / Secrétariat', superadmin: 'Super-administrateur' };
