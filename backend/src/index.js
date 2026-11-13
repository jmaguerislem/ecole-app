const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const config = require('./config');
const migrate = require('./migrate');
const { q, qa, runWith } = require('./db');
const { auth, allow } = require('./auth');
const { audit } = require('./audit');
const { ah, HttpError, eleveIdsOf } = require('./util');
const account = require('./routes/account');
const E = require('./routes/entities');
const S = require('./routes/scolarite');
const M = require('./routes/messagerie');
const appel = require('./routes/appel');
const saas = require('./routes/saas');
const demo = require('./routes/demo');
const stats = require('./routes/stats');
const bi = require('./routes/bi');
const A = require('./services/absences');
const { listerEcoles } = require('./services/ecoles');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
// L'application mobile (Capacitor) appelle l'API depuis ces origines : Android https://localhost, iOS capacitor://localhost
const NATIVE_ORIGINS = ['https://localhost', 'capacitor://localhost', 'ionic://localhost'];
app.use(cors(config.corsOrigin ? { origin: [...config.corsOrigin.split(',').map((o) => o.trim()), ...NATIVE_ORIGINS], credentials: true } : {}));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use(['/api/auth/set-password', '/api/auth/forgot-password'], rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, message: { error: 'Trop de tentatives, réessayez plus tard' } }));
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, message: { error: 'Trop de tentatives, réessayez plus tard' } }));
// Liste publique des écoles ouvertes (listes déroulantes des écrans publics). Limiteur à part : elle est rechargée à chaque affichage de page,
// contrairement aux envois de formulaires ci-dessous (20 par heure). Ne contient que id, nom, identifiant, ville et libellé.
app.get('/api/public/schools', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, message: { error: 'Trop de demandes, réessayez plus tard' } }),
  ah(async (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(await listerEcoles()); }));
app.use('/api/public', rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, message: { error: 'Trop de demandes, réessayez plus tard' } }), S.publicPre);
// Comptes de démonstration de la page de connexion (désactivés en production sauf DEMO_LOGIN=true)
app.use('/api/demo', rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, message: { error: 'Trop de tentatives, réessayez plus tard' } }), demo);
app.use('/api', account.pub);

// ----- Routes authentifiées -----
app.use('/api', auth, account.priv);
app.use('/api/saas', auth, saas); // gestion des écoles (super-administrateur)
app.use('/api/stats', auth, stats); // statistiques globales (directeurs + super-administrateur) : compteurs agrégés de toutes les écoles
app.use('/api/bi', auth, bi); // aide à la décision (BI) : directeur uniquement, lecture seule
app.use('/api/users', auth, E.usersExtra);
app.use('/api/users', E.users);
app.use('/api/classes', E.classes);
app.use('/api/matieres', E.matieres);
app.use('/api/salles', E.salles);
app.use('/api/affectations', E.affectations);
app.use('/api/tarifs', E.tarifsExtra);
app.use('/api/tarifs', E.tarifs);
app.use('/api/evaluations', E.evaluations);
app.use('/api/absences/appel', auth, appel);
app.use('/api/absences', E.absences);
app.put('/api/absences/:id(\\d+)/justifier', auth, allow('parent'), ah(async (req, res) => {
  const a = (await q('SELECT * FROM absences WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
  if (!a || !(await eleveIdsOf(req.user)).includes(a.eleve_id)) throw new HttpError(404, 'Absence introuvable');
  if (a.justifiee) throw new HttpError(400, 'Cette absence est déjà justifiée');
  const justification = A.checkJustification(req.body.justification);
  if (!justification || justification.length < 5) throw new HttpError(400, 'Motif de justification requis (5 caractères minimum)');
  const n = (await q('UPDATE absences SET justification=$1, justifiee=TRUE WHERE id=$2 RETURNING *', [justification, a.id])).rows[0];
  await audit(null, req.user, 'update', 'absences', a.id, a, n);
  res.json(n);
}));
app.use('/api/eleves', E.elevesPhoto);
app.use('/api/eleves', auth, S.elevesExtra);
app.use('/api', auth, S.notes); // /evaluations/:id/notes, /eleves/:id/bulletin(.pdf)
app.use('/api/eleves', E.eleves);
app.use('/api/creneaux', S.creneaux);
app.use('/api/paiements', auth, S.paiementsExtra);
app.use('/api/paiements', S.paiements);
app.use('/api/preinscriptions', auth, S.preActions);
app.use('/api/preinscriptions', S.pre);
app.use('/api/messages', auth, M.messages);
app.use('/api/annonces', auth, M.annonces);
app.use('/api/devoirs', auth, M.devoirs);
app.use('/api/dashboard', auth, M.dashboard);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Route inconnue' }));

// ----- Frontend compilé (déploiement mono-service) -----
const dist = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// ----- Gestion d'erreurs -----
app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err.code === '23505') return res.status(409).json({ error: 'Cet enregistrement existe déjà (doublon)' });
  if (err.code === '23503') return res.status(409).json({ error: 'Référence invalide ou enregistrement encore utilisé' });
  if (err.code === '22P02' || err.code === '22007' || err.code === '23514' || err.code === '23502') return res.status(400).json({ error: 'Données invalides' });
  if (err.name === 'MulterError') return res.status(400).json({ error: `Fichier refusé : ${err.message}` });
  console.error(err);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

async function start() {
  if (process.env.AUTO_MIGRATE !== 'false') await migrate();
  if (process.env.RELANCES_CRON === 'true') {
    // Tâche de fond : elle n'a pas de connexion, donc l'école est passée explicitement, école par école
    cron.schedule('0 8 * * 1', async () => {
      const ecoles = (await qa("SELECT id, nom FROM schools WHERE status <> 'suspended' AND (subscription_end IS NULL OR subscription_end >= CURRENT_DATE) ORDER BY id")).rows;
      for (const e of ecoles) {
        await runWith({ schoolId: e.id, schoolNom: e.nom }, async () => {
          const admin = (await q("SELECT id FROM users WHERE role='admin' AND deleted_at IS NULL ORDER BY id LIMIT 1")).rows[0];
          if (admin) console.log(`[cron] école ${e.id} – relances envoyées :`, await S.envoyerRelances(admin.id));
        }).catch((err) => console.error(`[cron] école ${e.id} :`, err.message));
      }
    });
  }
  app.listen(config.port, () => console.log(`API prête sur le port ${config.port} – année ${config.anneeCourante}`));
}
if (require.main === module) start().catch((e) => { console.error(e); process.exit(1); });
module.exports = { app, start };
