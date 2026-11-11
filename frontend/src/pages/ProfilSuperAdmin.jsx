import { useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { AuthImage } from '../components/EleveFields.jsx';
import { Alert, Avatar, PageHeader, PasswordInput } from '../components/ui.jsx';
import { EMAIL, MOT_DE_PASSE, NOM } from '../rules.js';

// Mon profil (super-administrateur) : nom, prénom, e-mail, téléphone, photo, mot de passe. Tout est enregistré en base (users).
export default function ProfilSuperAdmin() {
  const { user, refresh } = useAuth();
  const [f, setF] = useState({ nom: user.nom || '', prenom: user.prenom || '', email: user.email || '', telephone: user.telephone || '', mot_de_passe_actuel: '' });
  const [pw, setPw] = useState({ ancien: '', nouveau: '', confirmation: '' });
  const [m1, setM1] = useState(null); const [m2, setM2] = useState(null); const [m3, setM3] = useState(null);
  const [busy, setBusy] = useState(false); const file = useRef();
  const emailChange = f.email.trim().toLowerCase() !== user.email;

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setM1(null);
    try {
      await api('/saas/profil', { method: 'PUT', body: { nom: f.nom, prenom: f.prenom, email: f.email, telephone: f.telephone, ...(emailChange ? { mot_de_passe_actuel: f.mot_de_passe_actuel } : {}) } });
      await refresh(); setF((s) => ({ ...s, mot_de_passe_actuel: '' })); setM1({ k: 'ok', t: 'Profil enregistré.' });
    } catch (x) { setM1({ k: 'err', t: x.message }); } finally { setBusy(false); }
  };
  const changePw = async (e) => {
    e.preventDefault(); setM3(null);
    if (pw.nouveau !== pw.confirmation) return setM3({ k: 'err', t: 'La confirmation ne correspond pas au nouveau mot de passe.' });
    try { await api('/auth/change-password', { method: 'POST', body: pw }); setPw({ ancien: '', nouveau: '', confirmation: '' }); setM3({ k: 'ok', t: 'Mot de passe modifié.' }); }
    catch (x) { setM3({ k: 'err', t: x.message }); }
  };
  const upload = async (e) => {
    const img = e.target.files[0]; e.target.value = ''; if (!img) return; setM2(null);
    const form = new FormData(); form.append('photo', img);
    try { await api('/saas/profil/photo', { method: 'POST', form }); await refresh(); setM2({ k: 'ok', t: 'Photo mise à jour.' }); } catch (x) { setM2({ k: 'err', t: x.message }); }
  };
  const retirer = async () => { setM2(null); try { await api('/saas/profil/photo', { method: 'DELETE' }); await refresh(); setM2({ k: 'ok', t: 'Photo retirée.' }); } catch (x) { setM2({ k: 'err', t: x.message }); } };
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  return (
    <div>
      <PageHeader title="Mon profil" subtitle="Vos informations de propriétaire de la plateforme." />
      <section className="card">
        <h2>Photo de profil</h2>
        <div className="row" style={{ gap: '1rem' }}>
          <AuthImage key={user.photo || 'none'} src={user.photo} alt="Votre photo de profil" className="profile-photo" fallback={<Avatar prenom={user.prenom} nom={user.nom} size={96} />} />
          <div className="row">
            <button type="button" className="btn sec" onClick={() => file.current.click()}>{user.photo ? 'Changer la photo' : 'Ajouter une photo'}</button>
            {user.photo && <button type="button" className="btn danger" onClick={retirer}>Retirer</button>}
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={upload} />
          </div>
        </div>
        <p className="muted small">JPEG, PNG ou WebP, 5 Mo maximum.</p>
        {m2 && <Alert kind={m2.k}>{m2.t}</Alert>}
      </section>

      <form className="card" onSubmit={save}>
        <h2>Informations personnelles</h2>
        <div className="form-grid">
          <div><label htmlFor="pr-nom">Nom *</label><input id="pr-nom" required {...NOM} value={f.nom} onChange={set('nom')} /></div>
          <div><label htmlFor="pr-prenom">Prénom *</label><input id="pr-prenom" required {...NOM} value={f.prenom} onChange={set('prenom')} /></div>
          <div><label htmlFor="pr-email">E-mail (identifiant de connexion) *</label><input id="pr-email" type="email" required {...EMAIL} value={f.email} onChange={set('email')} /></div>
          <div><label htmlFor="pr-tel">Téléphone</label><input id="pr-tel" type="tel" inputMode="numeric" maxLength={11} pattern="[0-9 ]{8,11}" placeholder="8 chiffres" title="8 chiffres" value={f.telephone} onChange={set('telephone')} /></div>
          {emailChange && <div className="full"><label htmlFor="pr-mdp">Mot de passe actuel (requis pour changer l'e-mail) *</label><PasswordInput id="pr-mdp" required maxLength={128} autoComplete="current-password" value={f.mot_de_passe_actuel} onChange={set('mot_de_passe_actuel')} /></div>}
        </div>
        {m1 && <Alert kind={m1.k}>{m1.t}</Alert>}
        <button className="btn" style={{ marginTop: '.8rem' }} disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
      </form>

      <form className="card" onSubmit={changePw}>
        <h2>Changer le mot de passe</h2>
        <div className="form-grid">
          <div><label htmlFor="pw-o">Mot de passe actuel *</label><PasswordInput id="pw-o" required maxLength={128} autoComplete="current-password" value={pw.ancien} onChange={(e) => setPw({ ...pw, ancien: e.target.value })} /></div>
          <div><label htmlFor="pw-n">Nouveau mot de passe *</label><PasswordInput id="pw-n" required {...MOT_DE_PASSE} autoComplete="new-password" value={pw.nouveau} onChange={(e) => setPw({ ...pw, nouveau: e.target.value })} /><div className="help">8 caractères minimum, avec une lettre et un chiffre.</div></div>
          <div><label htmlFor="pw-c">Confirmer *</label><PasswordInput id="pw-c" required maxLength={128} autoComplete="new-password" value={pw.confirmation} onChange={(e) => setPw({ ...pw, confirmation: e.target.value })} /></div>
        </div>
        {m3 && <Alert kind={m3.k}>{m3.t}</Alert>}
        <button className="btn" style={{ marginTop: '.8rem' }}>Modifier le mot de passe</button>
      </form>
    </div>
  );
}
