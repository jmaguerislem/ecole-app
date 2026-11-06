import { useEffect, useState } from 'react';
import { api, fmtDate } from '../api.js';
import Icon from '../components/Icon.jsx';
import { Alert, Modal, PageHeader, Pill } from '../components/ui.jsx';
import SchoolSelect, { useSchools } from '../components/SchoolSelect.jsx';
import { EMAIL, LIBELLE, MOT_DE_PASSE, NOM } from '../rules.js';

const STATUTS = { trial: 'Essai', active: 'Actif', suspended: 'Suspendu' };
const PLANS = { basic: 'Basic', standard: 'Standard', premium: 'Premium' };
const VIDE = { nom: '', slug: '', ville: '', adresse: '', telephone: '', email_contact: '', plan: 'basic', status: 'trial', subscription_end: '', admin: { email: '', nom: '', prenom: '', password: '' } };
const today = new Date().toISOString().slice(0, 10);

// Espace du propriétaire de la plateforme : création, suspension et suivi des écoles
export default function Ecoles() {
  // Même liste (mêmes écoles, même libellé, même ordre) que les listes déroulantes des autres écrans ; ici toutes les écoles, suspendues comprises
  const { list, error: loadErr, reload: load } = useSchools({ all: true });
  const [filtre, setFiltre] = useState(''); // identifiant (slug) de l'école filtrée, '' = toutes
  const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  const [form, setForm] = useState(null); const [edit, setEdit] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (loadErr) setErr(loadErr); }, [loadErr]);
  const affichees = list?.filter((s) => !filtre || s.slug === filtre);
  const lien = (s) => `${window.location.origin}/preinscription/${s.slug}`;

  const creer = async (e) => {
    e.preventDefault(); setErr(''); setOk(''); setBusy(true);
    try {
      const body = { ...form, slug: form.slug || undefined, adresse: form.adresse || undefined, telephone: form.telephone || undefined, email_contact: form.email_contact || undefined, subscription_end: form.subscription_end || undefined, admin: { ...form.admin, password: form.admin.password || undefined } };
      const r = await api('/saas/schools', { method: 'POST', body });
      setOk(`École « ${r.nom} » créée. Direction : ${r.admin_email}${r.mot_de_passe_initial ? ` — mot de passe initial (à transmettre, affiché une seule fois) : ${r.mot_de_passe_initial}` : ''}`);
      setForm(null); load();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const modifier = async (e) => {
    e.preventDefault(); setErr(''); setOk(''); setBusy(true);
    try {
      await api(`/saas/schools/${edit.id}`, { method: 'PUT', body: { nom: edit.nom, ville: edit.ville, adresse: edit.adresse || null, telephone: edit.telephone || null, email_contact: edit.email_contact || null, plan: edit.plan, status: edit.status, subscription_end: edit.subscription_end || null } });
      setEdit(null); setOk('École mise à jour.'); load();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const basculer = async (s) => {
    const suspendre = s.status !== 'suspended';
    if (!window.confirm(suspendre ? `Suspendre « ${s.nom} » ? Tous ses utilisateurs seront déconnectés de fait.` : `Réactiver « ${s.nom} » ?`)) return;
    setErr(''); setOk('');
    try { await api(`/saas/schools/${s.id}`, { method: 'PUT', body: { status: suspendre ? 'suspended' : 'active' } }); load(); } catch (x) { setErr(x.message); }
  };
  // Prolonge l'abonnement (à partir de la fin actuelle si elle est future, sinon d'aujourd'hui) et active l'école
  const prolonger = async (s, mois) => {
    const base = s.subscription_end && s.subscription_end > today ? new Date(s.subscription_end) : new Date(today);
    base.setUTCMonth(base.getUTCMonth() + mois);
    const fin = base.toISOString().slice(0, 10);
    if (!window.confirm(`Prolonger « ${s.nom} » de ${mois} mois (jusqu'au ${fmtDate(fin)}) et passer en statut Actif ?`)) return;
    setErr(''); setOk('');
    try { await api(`/saas/schools/${s.id}`, { method: 'PUT', body: { status: 'active', subscription_end: fin } }); setOk(`Abonnement prolongé jusqu'au ${fmtDate(fin)}.`); load(); } catch (x) { setErr(x.message); }
  };
  const f = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const fa = (k) => (e) => setForm((s) => ({ ...s, admin: { ...s.admin, [k]: e.target.value } }));

  return (
    <div>
      <PageHeader title="Écoles" subtitle="Chaque école ne voit que ses propres données. Le lien d'inscription de l'école permet aux parents de se pré-inscrire dans la bonne école."><button type="button" className="btn" onClick={() => { setForm(VIDE); setOk(''); setErr(''); }}><Icon name="plus" size={16} />Nouvelle école</button></PageHeader>
      <Alert>{err}</Alert><Alert kind="ok">{ok}</Alert>
      <div className="filters">
        <div>
          <label htmlFor="filtre-ecole">École</label>
          <SchoolSelect id="filtre-ecole" schools={list} value={filtre} onChange={setFiltre} emptyLabel={`Toutes les écoles${list ? ` (${list.length})` : ''}`} />
        </div>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>École</th><th>Formule</th><th>Statut</th><th>Fin d'abonnement</th><th>Utilisateurs</th><th>Élèves</th><th>Lien de pré-inscription</th><th /></tr></thead>
        <tbody>
          {list === null && <tr><td colSpan="8" className="empty">Chargement…</td></tr>}
          {affichees?.length === 0 && <tr><td colSpan="8" className="empty">Aucune école.</td></tr>}
          {affichees?.map((s) => (
            <tr key={s.id}>
              <td><b>{s.nom}</b><div className="muted small">{s.ville ? `${s.ville} · ` : ''}{s.slug}{s.telephone ? ` · ${s.telephone}` : ''}</div>{s.adresse && <div className="muted small">{s.adresse}</div>}</td><td>{PLANS[s.plan]}</td>
              <td><Pill kind={s.status === 'active' ? 'ok' : s.status === 'trial' ? 'warn' : 'bad'}>{STATUTS[s.status]}</Pill></td>
              <td>{s.subscription_end ? fmtDate(s.subscription_end) : '—'}</td><td>{s.nb_utilisateurs}</td><td>{s.nb_eleves}</td>
              <td><button className="btn sec sm" onClick={() => navigator.clipboard?.writeText(lien(s)).then(() => setOk(`Lien copié : ${lien(s)}`))}>Copier le lien</button></td>
              <td><div className="row"><button className="btn sec sm" onClick={() => setEdit({ ...s, subscription_end: s.subscription_end || '' })}>Modifier</button>
                <button className="btn sec sm" onClick={() => basculer(s)}>{s.status === 'suspended' ? 'Réactiver' : 'Suspendre'}</button>
                <button className="btn sec sm" onClick={() => prolonger(s, 1)}>+1 mois</button><button className="btn sec sm" onClick={() => prolonger(s, 12)}>+1 an</button></div></td>
            </tr>))}
        </tbody>
      </table></div>

      {form && <Modal title="Nouvelle école" onClose={() => setForm(null)} wide>
        <form onSubmit={creer}>
          <div className="form-grid">
            <div><label htmlFor="e-nom">Nom de l'école *</label><input id="e-nom" required {...LIBELLE(120)} value={form.nom} onChange={f('nom')} /></div>
            <div><label htmlFor="e-ville">Ville *</label><input id="e-ville" required minLength={2} maxLength={60} pattern="\p{L}[\p{L}\p{M} '’.\-]*" title="Lettres, espaces, apostrophes et tirets" value={form.ville} onChange={f('ville')} /></div>
            <div><label htmlFor="e-adr">Adresse</label><input id="e-adr" maxLength={200} value={form.adresse} onChange={f('adresse')} /></div>
            <div><label htmlFor="e-tel">Téléphone</label><input id="e-tel" type="tel" inputMode="numeric" maxLength={11} pattern="[0-9 ]{8,11}" placeholder="8 chiffres, ex. 71 245 300" title="Numéro tunisien : 8 chiffres" value={form.telephone} onChange={f('telephone')} /></div>
            <div><label htmlFor="e-mail">E-mail de contact</label><input id="e-mail" type="email" {...EMAIL} value={form.email_contact} onChange={f('email_contact')} /></div>
            <div><label htmlFor="e-slug">Identifiant du lien</label><input id="e-slug" maxLength={40} pattern="[a-z0-9]([a-z0-9\-]{0,38}[a-z0-9])?" title="Minuscules, chiffres et tirets" placeholder="généré depuis le nom" value={form.slug} onChange={f('slug')} /></div>
            <div><label htmlFor="e-plan">Formule</label><select id="e-plan" value={form.plan} onChange={f('plan')}>{Object.entries(PLANS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div><label htmlFor="e-st">Statut</label><select id="e-st" value={form.status} onChange={f('status')}><option value="trial">Essai</option><option value="active">Actif</option></select></div>
            <div><label htmlFor="e-fin">Fin d'abonnement</label><input id="e-fin" type="date" min={today} value={form.subscription_end} onChange={f('subscription_end')} /></div>
          </div>
          <h2 style={{ fontSize: '1rem', marginTop: '1rem' }}>Compte de la direction</h2>
          <div className="form-grid">
            <div><label htmlFor="a-nom">Nom *</label><input id="a-nom" required {...NOM} value={form.admin.nom} onChange={fa('nom')} /></div>
            <div><label htmlFor="a-prenom">Prénom *</label><input id="a-prenom" required {...NOM} value={form.admin.prenom} onChange={fa('prenom')} /></div>
            <div><label htmlFor="a-email">E-mail (identifiant) *</label><input id="a-email" type="email" required {...EMAIL} value={form.admin.email} onChange={fa('email')} /></div>
            <div><label htmlFor="a-pw">Mot de passe</label><input id="a-pw" type="password" autoComplete="new-password" {...MOT_DE_PASSE} placeholder="généré automatiquement si vide" value={form.admin.password} onChange={fa('password')} /></div>
          </div>
          <div className="row" style={{ marginTop: '1rem' }}><button className="btn" disabled={busy}>{busy ? 'Création…' : "Créer l'école"}</button><button type="button" className="btn sec" onClick={() => setForm(null)}>Annuler</button></div>
        </form>
      </Modal>}

      {edit && <Modal title={`Modifier – ${edit.nom}`} onClose={() => setEdit(null)}>
        <form onSubmit={modifier}>
          <div className="form-grid">
            <div><label htmlFor="m-nom">Nom *</label><input id="m-nom" required {...LIBELLE(120)} value={edit.nom} onChange={(e) => setEdit({ ...edit, nom: e.target.value })} /></div>
            <div><label htmlFor="m-ville">Ville *</label><input id="m-ville" required minLength={2} maxLength={60} pattern="\p{L}[\p{L}\p{M} '’.\-]*" title="Lettres, espaces, apostrophes et tirets" value={edit.ville || ''} onChange={(e) => setEdit({ ...edit, ville: e.target.value })} /></div>
            <div><label htmlFor="m-adr">Adresse</label><input id="m-adr" maxLength={200} value={edit.adresse || ''} onChange={(e) => setEdit({ ...edit, adresse: e.target.value })} /></div>
            <div><label htmlFor="m-tel">Téléphone</label><input id="m-tel" type="tel" inputMode="numeric" maxLength={11} pattern="[0-9 ]{8,11}" placeholder="8 chiffres, ex. 71 245 300" title="Numéro tunisien : 8 chiffres" value={edit.telephone || ''} onChange={(e) => setEdit({ ...edit, telephone: e.target.value })} /></div>
            <div><label htmlFor="m-mail">E-mail de contact</label><input id="m-mail" type="email" {...EMAIL} value={edit.email_contact || ''} onChange={(e) => setEdit({ ...edit, email_contact: e.target.value })} /></div>
            <div><label htmlFor="m-plan">Formule</label><select id="m-plan" value={edit.plan} onChange={(e) => setEdit({ ...edit, plan: e.target.value })}>{Object.entries(PLANS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div><label htmlFor="m-st">Statut</label><select id="m-st" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{Object.entries(STATUTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div><label htmlFor="m-fin">Fin d'abonnement</label><input id="m-fin" type="date" value={edit.subscription_end} onChange={(e) => setEdit({ ...edit, subscription_end: e.target.value })} /></div>
          </div>
          <div className="row" style={{ marginTop: '1rem' }}><button className="btn" disabled={busy}>Enregistrer</button><button type="button" className="btn sec" onClick={() => setEdit(null)}>Annuler</button></div>
        </form>
      </Modal>}
    </div>
  );
}
