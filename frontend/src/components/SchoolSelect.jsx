import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

// Liste des écoles : MÊME source de données et MÊME libellé « Nom (Ville) » dans tous les écrans (le serveur les calcule, services/ecoles.js).
//  - par défaut : écoles ouvertes (écrans publics, ex. pré-inscription)  → GET /api/public/schools
//  - all        : toutes les écoles, y compris suspendues (super-administrateur) → GET /api/saas/schools
export function useSchools({ all = false } = {}) {
  const [state, setState] = useState({ list: null, error: '' });
  const reload = useCallback(
    () => api(all ? '/saas/schools' : '/public/schools')
      .then((list) => setState({ list, error: '' }))
      .catch((e) => setState({ list: [], error: e.message })),
    [all],
  );
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

// Liste déroulante des écoles. `value` = identifiant (slug) de l'école choisie ; '' = aucune / toutes.
export default function SchoolSelect({ id = 'ecole', value, onChange, schools, emptyLabel = '— Choisir une école —', required = false, disabled = false, ...rest }) {
  return (
    <select id={id} name="ecole" value={value ?? ''} required={required} disabled={disabled || schools === null} onChange={(e) => onChange(e.target.value)} {...rest}>
      <option value="">{schools === null ? 'Chargement des écoles…' : emptyLabel}</option>
      {(schools || []).map((s) => (
        <option key={s.id} value={s.slug}>{s.label}{s.ouverte === false ? ' – suspendue ou expirée' : ''}</option>
      ))}
    </select>
  );
}
