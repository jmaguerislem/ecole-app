// Libellé d'une école affiché partout : « Nom (Ville) ». Sans dépendance (utilisable par auth.js et les services).
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// La ville est ajoutée pour distinguer deux écoles de même nom, sauf si le nom la contient déjà (évite « … – Nabeul (Nabeul) »).
function libelleEcole(s) {
  const ville = String(s.ville || '').trim();
  if (!ville || norm(s.nom).includes(norm(ville))) return s.nom;
  return `${s.nom} (${ville})`;
}
module.exports = { libelleEcole, norm };
