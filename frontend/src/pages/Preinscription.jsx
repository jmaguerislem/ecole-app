import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, Field } from '../components/ui.jsx';

import { NOM, EMAIL } from '../rules.js';
import { useParams } from 'react-router-dom';
const AGE_MIN = 6;
const NIVEAUX = ['1ère', '2ème', '3ème', '4ème', '5ème', '6ème'].map((n) => ({ value: `${n} année`, label: `${n} année` }));
const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
// Date de naissance maximale : l'enfant doit avoir au moins AGE_MIN ans aujourd'hui
const MAX_NAISSANCE = toISO(new Date(today.getFullYear() - AGE_MIN, today.getMonth(), today.getDate()));
const MIN_NAISSANCE = `${today.getFullYear() - 20}-01-01`;
const PHONE_RE = /^\d{8}$/;

const FIELDS = [
  { name: 'eleve_nom', label: "Nom de l'enfant", required: true, ...NOM }, { name: 'eleve_prenom', label: "Prénom de l'enfant", required: true, ...NOM },
  { name: 'date_naissance', label: 'Date de naissance', type: 'date', required: true, min: MIN_NAISSANCE, max: MAX_NAISSANCE, help: `L'enfant doit avoir au moins ${AGE_MIN} ans.` },
  { name: 'sexe', label: 'Sexe', type: 'select', options: [{ value: 'M', label: 'Garçon' }, { value: 'F', label: 'Fille' }] },
  { name: 'niveau_souhaite', label: 'Niveau souhaité', type: 'select', options: NIVEAUX },
  { name: 'parent_nom', label: 'Nom du parent / tuteur', required: true, ...NOM }, { name: 'parent_prenom', label: 'Prénom du parent / tuteur', required: true, ...NOM },
  { name: 'parent_email', label: 'E-mail du parent', type: 'email', required: true, ...EMAIL }, { name: 'parent_telephone', label: 'Téléphone', type: 'tel', inputMode: 'numeric', maxLength: 8, pattern: '[0-9]{8}', placeholder: '8 chiffres, ex. 20123456', title: 'Numéro tunisien : 8 chiffres' },
  { name: 'adresse', label: 'Adresse', full: true, maxLength: 200 }, { name: 'antecedents_medicaux', label: 'Antécédents médicaux / allergies', type: 'textarea', full: true, maxLength: 1000 },
];
export default function Preinscription() {
  const { config } = useAuth();
  const { slug } = useParams(); // l'école est celle du lien d'inscription : /preinscription/<identifiant-de-l-ecole>
  const [ecoleNom, setEcoleNom] = useState(config.ecoleNom);
  useEffect(() => { if (slug) api(`/config?ecole=${encodeURIComponent(slug)}`).then((c) => setEcoleNom(c.ecoleNom)).catch(() => {}); }, [slug]);
  const [v, setV] = useState({ consentement_rgpd: false });
  const [err, setErr] = useState(''); const [done, setDone] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (v.date_naissance) {
      if (v.date_naissance > MAX_NAISSANCE) return setErr(`L'enfant doit avoir au moins ${AGE_MIN} ans.`);
      if (v.date_naissance < MIN_NAISSANCE) return setErr('Date de naissance invalide.');
    }
    if (v.parent_telephone && !PHONE_RE.test(v.parent_telephone)) return setErr('Le numéro de téléphone doit contenir exactement 8 chiffres.');
    try { await api(slug ? `/public/${encodeURIComponent(slug)}/preinscriptions` : '/public/preinscriptions', { method: 'POST', body: v }); setDone(true); } catch (x) { setErr(x.message); }
  };
  return (
    <div className="login" style={{ alignItems: 'start' }}>
      <form className="card" style={{ maxWidth: 760 }} onSubmit={submit}>
        <h1>Pré-inscription – {ecoleNom}</h1>
        {done ? <><Alert kind="ok">Votre demande a bien été envoyée. L'administration vous contactera après validation.</Alert><Link to="/login">Retour à la connexion</Link></> : <>
          <div className="form-grid">{FIELDS.map((f) => <Field key={f.name} f={f} value={v[f.name]} options={f.options} onChange={(x) => setV((s) => ({ ...s, [f.name]: f.name === 'parent_telephone' ? x.replace(/\D/g, '').slice(0, 8) : x }))} />)}</div>
          <div style={{ marginTop: '1rem' }}><label><input type="checkbox" checked={v.consentement_rgpd} onChange={(e) => setV((s) => ({ ...s, consentement_rgpd: e.target.checked }))} />
            Je consens, en tant que parent ou tuteur légal, au traitement des données de mon enfant pour la gestion de sa scolarité (RGPD). *</label></div>
          <Alert>{err}</Alert>
          <div className="row" style={{ marginTop: '1rem' }}><button className="btn">Envoyer la demande</button><Link to="/login">Annuler</Link></div></>}
      </form>
    </div>
  );
}
