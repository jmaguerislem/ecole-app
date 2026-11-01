const BASE = '/api';
export const getToken = () => localStorage.getItem('token');
export const setToken = (t) => (t ? localStorage.setItem('token', t) : localStorage.removeItem('token'));

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && t) { setToken(null); window.location.href = '/login'; }
    throw Object.assign(new Error(data?.error || `Erreur ${res.status}`), { status: res.status, data });
  }
  return data;
}
// Téléchargement/ouverture d'un fichier protégé (JWT dans l'en-tête)
export async function download(path, filename, open = false) {
  const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error('Téléchargement impossible');
  const url = URL.createObjectURL(await res.blob());
  if (open) window.open(url, '_blank');
  else { const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const money = (n) => `${Number(n || 0).toFixed(2)} TND`;
export const ROLES = { admin: 'Administrateur', enseignant: 'Enseignant', parent: 'Parent', eleve: 'Élève', comptable: 'Comptable / Secrétariat', superadmin: 'Super-administrateur' };
