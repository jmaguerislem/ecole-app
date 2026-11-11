const jwt = require('jsonwebtoken');
const { qa, runWith } = require('./db');
const c = require('./config');
// (libelleEcole est défini sans dépendance pour éviter un import circulaire avec services/ecoles.js)
const { libelleEcole } = require('./libelle-ecole');

// Le jeton contient l'école (`sch`) : elle est aussi revérifiée en base à chaque requête (jamais lue depuis la page).
const sign = (u) => jwt.sign({ sub: u.id, role: u.role, sch: u.school_id ?? null }, c.jwtSecret, { expiresIn: c.jwtExpires });

const aujourdhui = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Tunis' });
// Message de refus si l'abonnement de l'école est suspendu ou expiré (null sinon)
function abonnementBloque(s) {
  if (!s) return null;
  if (s.status === 'suspended') return "L'abonnement de votre école est suspendu. Contactez l'administrateur de la plateforme.";
  if (s.subscription_end && s.subscription_end < aujourdhui()) return "L'abonnement de votre école a expiré. Contactez l'administrateur de la plateforme.";
  return null;
}

const PASSWORD_CHANGE_OK = ['/api/auth/me', '/api/auth/change-password'];
async function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentification requise' });
  let u;
  try {
    const p = jwt.verify(token, c.jwtSecret);
    const { rows } = await qa(
      `SELECT u.id,u.email,u.role,u.nom,u.prenom,u.telephone,u.photo,u.must_change_password,u.actif,u.school_id, s.nom AS school_nom, s.slug AS school_slug, s.ville AS school_ville, s.status AS school_status, s.subscription_end
       FROM users u LEFT JOIN schools s ON s.id=u.school_id WHERE u.id=$1 AND u.deleted_at IS NULL`, [p.sub]);
    u = rows[0];
    if (!u || !u.actif) return res.status(401).json({ error: 'Compte inactif ou supprimé' });
    if ((u.school_id ?? null) !== (p.sch ?? null)) return res.status(401).json({ error: 'Session invalide ou expirée' });
  } catch {
    return res.status(401).json({ error: 'Session invalide ou expirée' });
  }
  if (u.role !== 'superadmin') {
    const refus = abonnementBloque({ status: u.school_status, subscription_end: u.subscription_end });
    if (refus) return res.status(403).json({ error: refus });
  }
  // Mot de passe temporaire : tant qu'il n'est pas changé, seuls « qui suis-je » et « changer le mot de passe » sont accessibles (contrôle côté serveur, pas seulement dans l'interface)
  if (u.must_change_password && !PASSWORD_CHANGE_OK.includes(req.originalUrl.split('?')[0].replace(/\/+$/, ''))) {
    return res.status(403).json({ error: 'Vous devez d\'abord choisir un nouveau mot de passe (mot de passe temporaire).', code: 'password_change_required' });
  }
  const { school_nom, school_slug, school_ville, school_status, subscription_end, ...user } = u;
  req.user = user;
  req.school = u.school_id ? { id: u.school_id, nom: school_nom, slug: school_slug, ville: school_ville, label: libelleEcole({ nom: school_nom, ville: school_ville }) } : null;
  // Tout ce qui suit (filtres, créations) s'exécute dans le contexte de CETTE école. Le super-administrateur n'a aucune école :
  // il ne voit donc aucune donnée d'école (ses écrans utilisent des requêtes dédiées).
  req.tenant = { schoolId: u.school_id ?? null, schoolNom: school_nom || null };
  runWith(req.tenant, next);
}
const allow = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Accès refusé pour votre rôle' });

module.exports = { sign, auth, allow, abonnementBloque };
