import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import AuthShell from '../components/AuthShell.jsx';
import { Alert, Field } from '../components/ui.jsx';
import SchoolSelect, { useSchools } from '../components/SchoolSelect.jsx';
import { NOM, EMAIL } from '../rules.js';

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
// Le formulaire long est découpé en trois blocs pour être plus facile à parcourir
const GROUPES = [
  ['Votre enfant', ['eleve_nom', 'eleve_prenom', 'date_naissance', 'sexe', 'niveau_souhaite']],
  ['Parent / tuteur', ['parent_nom', 'parent_prenom', 'parent_email', 'parent_telephone']],
  ['Informations complémentaires', ['adresse', 'antecedents_medicaux']],
];

export default function Preinscription() {
  const nav = useNavigate();
  const { slug: slugUrl } = useParams(); // lien d'inscription d'une école : /preinscription/<identifiant-de-l-ecole>
  const { list: ecoles, error: ecolesErr } = useSchools(); // même liste déroulante que partout ailleurs
  const [slug, setSlug] = useState(slugUrl || '');
  const ecole = ecoles?.find((s) => s.slug === slug) || null;
  // Une seule école ouverte : elle est choisie d'office
  useEffect(() => { if (ecoles?.length === 1 && !slug) setSlug(ecoles[0].slug); }, [ecoles, slug]);
  const choisir = (s) => { setSlug(s); setErr(''); nav(s ? `/preinscription/${s}` : '/preinscription', { replace: true }); };
  const [v, setV] = useState({ consentement_rgpd: false });
  const [err, setErr] = useState(''); const [done, setDone] = useState(false);
  const lienInconnu = !!slugUrl && ecoles !== null && !ecole; // lien d'une école inconnue, suspendue ou expirée
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (!ecole) return setErr('Choisissez votre école dans la liste.');
    if (v.date_naissance) {
      if (v.date_naissance > MAX_NAISSANCE) return setErr(`L'enfant doit avoir au moins ${AGE_MIN} ans.`);
      if (v.date_naissance < MIN_NAISSANCE) return setErr('Date de naissance invalide.');
    }
    if (v.parent_telephone && !PHONE_RE.test(v.parent_telephone)) return setErr('Le numéro de téléphone doit contenir exactement 8 chiffres.');
    try { await api(`/public/${encodeURIComponent(ecole.slug)}/preinscriptions`, { method: 'POST', body: v }); setDone(true); } catch (x) { setErr(x.message); }
  };
  const field = (name) => FIELDS.find((f) => f.name === name);
  return (
    <AuthShell wide back school={ecole?.nom} title="Demande de pré-inscription" subtitle={ecole ? `École : ${ecole.label}. Les champs marqués d'un astérisque sont obligatoires.` : "Choisissez votre école, puis remplissez le formulaire. Les champs marqués d'un astérisque sont obligatoires."}>
      {done ? (
        <div className="success">
          <Alert kind="ok">Votre demande a bien été envoyée. L'administration vous contactera après validation.</Alert>
          <Link className="btn sec" to="/login">Retour à la connexion</Link>
        </div>
      ) : (
        <form onSubmit={submit}>
          <fieldset className="fs">
            <legend>Votre école</legend>
            <div className="form-grid">
              <div className="full">
                <label htmlFor="f-ecole">École <span className="req" aria-hidden="true">*</span></label>
                <SchoolSelect id="f-ecole" required schools={ecoles} value={ecole ? slug : ''} onChange={choisir} emptyLabel="— Choisir votre école —" aria-describedby="f-ecole-help" />
                <div className="help" id="f-ecole-help">{ecole ? `Votre demande sera envoyée à : ${ecole.label}.` : 'La liste affiche les écoles qui acceptent actuellement les pré-inscriptions.'}</div>
              </div>
            </div>
            {lienInconnu && <Alert kind="warn">Cette école est introuvable ou n'accepte plus de pré-inscriptions. Choisissez une école dans la liste.</Alert>}
            {ecolesErr && <Alert>{ecolesErr}</Alert>}
          </fieldset>
          {GROUPES.map(([titre, noms]) => (
            <fieldset className="fs" key={titre}>
              <legend>{titre}</legend>
              <div className="form-grid">
                {noms.map((n) => { const f = field(n); return <Field key={n} f={f} value={v[n]} options={f.options} onChange={(x) => setV((s) => ({ ...s, [n]: n === 'parent_telephone' ? x.replace(/\D/g, '').slice(0, 8) : x }))} />; })}
              </div>
            </fieldset>
          ))}
          <label className="check"><input type="checkbox" checked={v.consentement_rgpd} onChange={(e) => setV((s) => ({ ...s, consentement_rgpd: e.target.checked }))} /><span>Je consens, en tant que parent ou tuteur légal, au traitement des données de mon enfant pour la gestion de sa scolarité (RGPD). <span className="req" aria-hidden="true">*</span></span></label>
          <Alert>{err}</Alert>
          <div className="modal-actions"><button className="btn">Envoyer la demande</button><Link className="btn sec" to="/login">Annuler</Link></div>
        </form>
      )}
    </AuthShell>
  );
}
