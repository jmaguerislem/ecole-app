// Messagerie (immuable après envoi), annonces, devoirs, tableau de bord
const express = require('express');
const { q, tx } = require('../db');
const { allow } = require('../auth');
const { audit } = require('../audit');
const { upload, filesInfo, removeFile } = require('../services/storage');
const { notify, sendMessage } = require('../services/notify');
const V = require('../services/validate');
const { solde } = require('../services/finance');
const { ah, HttpError, teacherCanTeach, teachSql, classAudience, eleveIdsOf } = require('../util');
const config = require('../config');

const CLASSE_NOM = (a) => `${a}.niveau||COALESCE(' '||${a}.section,'')`;

// ===================== Messagerie =====================
const messages = express.Router();
const TC = `SELECT classe_id AS id FROM affectations WHERE enseignant_id=$1 AND deleted_at IS NULL UNION SELECT id FROM classes WHERE titulaire_id=$1 AND deleted_at IS NULL`;
const ADMINS = `SELECT id,role,nom,prenom,NULL::text AS info FROM users WHERE role='admin' AND actif AND deleted_at IS NULL AND id<>$1`;
const RECIPIENTS = {
  admin: `SELECT id,role,nom,prenom,NULL::text AS info FROM users WHERE role<>'admin' AND actif AND deleted_at IS NULL AND id<>$1`,
  comptable: `SELECT id,role,nom,prenom,NULL::text AS info FROM users WHERE role='parent' AND actif AND deleted_at IS NULL AND id<>$1 UNION ${ADMINS}`,
  enseignant: `SELECT u.id,u.role,u.nom,u.prenom,string_agg(e.prenom,', ') AS info FROM users u JOIN eleve_parents ep ON ep.parent_id=u.id JOIN eleves e ON e.id=ep.eleve_id AND e.deleted_at IS NULL
               WHERE u.deleted_at IS NULL AND u.actif AND u.id<>$1 AND e.classe_id IN (${TC}) GROUP BY u.id UNION ${ADMINS}`,
  parent: `SELECT u.id,u.role,u.nom,u.prenom,NULL::text AS info FROM users u WHERE u.deleted_at IS NULL AND u.actif AND u.role='enseignant' AND u.id IN (
             SELECT a.enseignant_id FROM affectations a JOIN eleves e ON e.classe_id=a.classe_id AND e.deleted_at IS NULL JOIN eleve_parents ep ON ep.eleve_id=e.id WHERE ep.parent_id=$1 AND a.deleted_at IS NULL
             UNION SELECT c.titulaire_id FROM classes c JOIN eleves e ON e.classe_id=c.id AND e.deleted_at IS NULL JOIN eleve_parents ep ON ep.eleve_id=e.id WHERE ep.parent_id=$1 AND c.deleted_at IS NULL)
           UNION ${ADMINS}`,
  eleve: ADMINS,
};
const allowedRecipients = async (u) => (await q(RECIPIENTS[u.role], [u.id])).rows;

messages.get('/destinataires', ah(async (req, res) => res.json(await allowedRecipients(req.user))));

const MSG_COLS = `m.id, m.sender_id, m.thread_id, m.eleve_id, m.objet, m.corps, m.statut, m.attachments, m.sent_at, m.created_at, s.nom||' '||s.prenom AS sender_nom, s.role AS sender_role,
  (SELECT string_agg(u.nom||' '||u.prenom, ', ') FROM message_recipients r JOIN users u ON u.id=r.user_id WHERE r.message_id=m.id) AS destinataires_noms,
  (SELECT array_agg(r.user_id) FROM message_recipients r WHERE r.message_id=m.id) AS destinataires_ids`;
messages.get('/', ah(async (req, res) => {
  const box = req.query.box || 'inbox';
  let sql;
  if (box === 'inbox') sql = `SELECT ${MSG_COLS}, r.read_at FROM messages m JOIN users s ON s.id=m.sender_id JOIN message_recipients r ON r.message_id=m.id AND r.user_id=$1 AND r.hidden_at IS NULL WHERE m.statut='envoye' ORDER BY m.sent_at DESC`;
  else if (box === 'sent') sql = `SELECT ${MSG_COLS} FROM messages m JOIN users s ON s.id=m.sender_id WHERE m.sender_id=$1 AND m.statut='envoye' ORDER BY m.sent_at DESC`;
  else if (box === 'drafts') sql = `SELECT ${MSG_COLS}, m.draft_recipients FROM messages m JOIN users s ON s.id=m.sender_id WHERE m.sender_id=$1 AND m.statut='brouillon' ORDER BY m.created_at DESC`;
  else if (box === 'historique') sql = `SELECT DISTINCT ON (m.sent_at, m.id) ${MSG_COLS} FROM messages m JOIN users s ON s.id=m.sender_id LEFT JOIN message_recipients r ON r.message_id=m.id AND r.user_id=$1 WHERE m.statut='envoye' AND (m.sender_id=$1 OR r.user_id IS NOT NULL) ORDER BY m.sent_at DESC, m.id`;
  else throw new HttpError(400, 'Boîte inconnue');
  res.json((await q(sql, [req.user.id])).rows);
}));

async function writeMessage(req, res, { existing } = {}) {
  const b = req.body;
  let dest;
  try { dest = V.entiersId(JSON.parse(b.destinataires || '[]'), 'Les destinataires', { max: 50 }); } catch (e) { throw e instanceof HttpError ? e : new HttpError(400, 'Destinataires invalides'); }
  b.objet = V.texte(b.objet, "L'objet", { max: 150 });
  b.corps = V.texte(b.corps, 'Le message', { max: 5000, multiligne: true });
  const brouillon = b.brouillon === 'true' || b.brouillon === true;
  const files = filesInfo(req.files);
  if (!brouillon) {
    if (!b.objet || !b.corps) throw new HttpError(400, 'Objet et message obligatoires');
    if (!dest.length) throw new HttpError(400, 'Choisissez au moins un destinataire');
  } else if (!b.objet && !b.corps) throw new HttpError(400, 'Un brouillon doit contenir au moins un objet ou un texte');
  const ok = new Set((await allowedRecipients(req.user)).map((r) => r.id));
  const interdit = dest.filter((d) => !ok.has(d));
  if (interdit.length) throw new HttpError(403, "Vous n'êtes pas autorisé à écrire à l'un des destinataires choisis");
  let thread = b.thread_id ? Number(b.thread_id) : null;
  if (thread) {
    const root = (await q('SELECT m.id, m.thread_id FROM messages m LEFT JOIN message_recipients r ON r.message_id=m.id AND r.user_id=$2 WHERE m.id=$1 AND m.statut=\'envoye\' AND (m.sender_id=$2 OR r.user_id IS NOT NULL)', [thread, req.user.id])).rows[0];
    if (!root) throw new HttpError(403, 'Conversation inaccessible');
    thread = root.thread_id || root.id;
  }
  let id;
  if (existing) {
    const attach = [...existing.attachments, ...files];
    await q('UPDATE messages SET objet=$1, corps=$2, eleve_id=$3, thread_id=$4, attachments=$5, draft_recipients=$6 WHERE id=$7',
      [b.objet || '(sans objet)', b.corps || '', b.eleve_id || null, thread, JSON.stringify(attach), JSON.stringify(dest), existing.id]);
    id = existing.id;
  } else {
    id = (await q(`INSERT INTO messages(sender_id,thread_id,eleve_id,objet,corps,statut,attachments,draft_recipients) VALUES ($1,$2,$3,$4,$5,'brouillon',$6,$7) RETURNING id`,
      [req.user.id, thread, b.eleve_id || null, b.objet || '(sans objet)', b.corps || '', JSON.stringify(files), JSON.stringify(dest)])).rows[0].id;
  }
  if (!brouillon) await dispatch(id, dest, req.user);
  res.status(existing ? 200 : 201).json({ id, statut: brouillon ? 'brouillon' : 'envoye' });
}
async function dispatch(id, dest, user) {
  const m = (await q("UPDATE messages SET statut='envoye', sent_at=now() WHERE id=$1 AND statut='brouillon' RETURNING objet,corps", [id])).rows[0];
  if (!m) throw new HttpError(409, 'Message déjà envoyé');
  for (const d of dest) await q('INSERT INTO message_recipients(message_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, d]);
  await audit(null, user, 'send', 'messages', id, null, { destinataires: dest });
  await notify(dest, { type: 'message', titre: `Nouveau message de ${user.prenom} ${user.nom}`, corps: m.objet, lien: `/messagerie/${id}` });
}

messages.post('/', upload.array('fichiers', 5), ah((req, res) => writeMessage(req, res)));

async function ownDraft(req) {
  const m = (await q('SELECT * FROM messages WHERE id=$1', [req.params.id])).rows[0];
  if (!m) throw new HttpError(404, 'Message introuvable');
  if (m.sender_id !== req.user.id) throw new HttpError(403, 'Accès refusé');
  if (m.statut === 'envoye') throw new HttpError(403, 'Un message envoyé est immuable : il ne peut être ni modifié ni supprimé.');
  return m;
}
messages.put('/:id(\\d+)', upload.array('fichiers', 5), ah(async (req, res) => writeMessage(req, res, { existing: await ownDraft(req) })));
messages.delete('/:id(\\d+)', ah(async (req, res) => {
  const m = await ownDraft(req);
  for (const f of m.attachments) await removeFile(f.name);
  await q('DELETE FROM messages WHERE id=$1', [m.id]);
  res.json({ ok: true });
}));
messages.post('/:id(\\d+)/envoyer', ah(async (req, res) => {
  const m = await ownDraft(req);
  const dest = m.draft_recipients;
  if (!dest.length || !m.corps) throw new HttpError(400, 'Destinataire et texte requis');
  const ok = new Set((await allowedRecipients(req.user)).map((r) => r.id));
  if (dest.some((d) => !ok.has(d))) throw new HttpError(403, 'Destinataire non autorisé');
  await dispatch(m.id, dest, req.user);
  res.json({ ok: true });
}));
// Suppression côté destinataire uniquement (masquage logique)
messages.post('/:id(\\d+)/masquer', ah(async (req, res) => {
  const r = await q('UPDATE message_recipients SET hidden_at=now() WHERE message_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (!r.rowCount) throw new HttpError(403, "Vous n'êtes pas destinataire de ce message");
  res.json({ ok: true });
}));
// Lecture : fil de discussion (parties concernées uniquement) + journalisation des accès
messages.get('/:id(\\d+)', ah(async (req, res) => {
  const base = (await q(`SELECT m.id, m.thread_id FROM messages m LEFT JOIN message_recipients r ON r.message_id=m.id AND r.user_id=$2 WHERE m.id=$1 AND m.statut='envoye' AND (m.sender_id=$2 OR r.user_id IS NOT NULL)`, [req.params.id, req.user.id])).rows[0];
  if (!base) throw new HttpError(403, 'Conversation inaccessible');
  const root = base.thread_id || base.id;
  const { rows } = await q(
    `SELECT ${MSG_COLS} FROM messages m JOIN users s ON s.id=m.sender_id LEFT JOIN message_recipients r ON r.message_id=m.id AND r.user_id=$2
     WHERE m.statut='envoye' AND (m.id=$1 OR m.thread_id=$1) AND (m.sender_id=$2 OR r.user_id IS NOT NULL) ORDER BY m.sent_at, m.id`, [root, req.user.id]);
  await q('UPDATE message_recipients SET read_at=COALESCE(read_at,now()) WHERE user_id=$1 AND message_id = ANY($2)', [req.user.id, rows.map((r) => r.id)]);
  await q('INSERT INTO access_log(user_id,ressource,ressource_id) VALUES ($1,$2,$3)', [req.user.id, 'conversation', root]);
  res.json({ thread: root, messages: rows });
}));

// ===================== Annonces (immuables) =====================
const annonces = express.Router();
const AUD_ROLE = { parents: 'parent', enseignants: 'enseignant', eleves: 'eleve' };
annonces.get('/', ah(async (req, res) => {
  const u = req.user;
  const where = u.role === 'admin' ? 'TRUE' : `a.audience='tous' OR a.audience=${u.role === 'parent' ? "'parents'" : u.role === 'enseignant' ? "'enseignants'" : u.role === 'eleve' ? "'eleves'" : "'tous'"}`;
  res.json((await q(`SELECT a.*, u.nom||' '||u.prenom AS auteur_nom FROM annonces a JOIN users u ON u.id=a.auteur_id WHERE ${where} ORDER BY a.created_at DESC LIMIT 200`)).rows);
}));
annonces.post('/', allow('admin'), ah(async (req, res) => {
  const audience = req.body?.audience || 'tous';
  const titre = V.texte(req.body?.titre, 'Le titre', { required: true, min: 3, max: 120 });
  const corps = V.texte(req.body?.corps, 'Le contenu', { required: true, min: 3, max: 5000, multiligne: true });
  if (!['tous', 'parents', 'enseignants', 'eleves'].includes(audience)) throw new HttpError(400, 'Audience invalide');
  const a = (await q('INSERT INTO annonces(auteur_id,titre,corps,audience) VALUES ($1,$2,$3,$4) RETURNING *', [req.user.id, titre, corps, audience])).rows[0];
  await audit(null, req.user, 'create', 'annonces', a.id, null, a);
  const targets = (await q(`SELECT id FROM users WHERE actif AND deleted_at IS NULL AND id<>$1 ${audience === 'tous' ? '' : 'AND role=$2'}`, audience === 'tous' ? [req.user.id] : [req.user.id, AUD_ROLE[audience]])).rows.map((r) => r.id);
  notify(targets, { type: 'annonce', titre: `Annonce : ${titre}`, corps: corps.slice(0, 140), lien: '/annonces' }, { email: true }).catch(() => {});
  res.status(201).json(a);
}));
const immut = (_req, res) => res.status(403).json({ error: 'Une annonce publiée est immuable. Publiez une annonce corrective.' });
annonces.put('/:id', immut); annonces.patch('/:id', immut); annonces.delete('/:id', immut);

// ===================== Devoirs =====================
const devoirs = express.Router();
const STATUT = `CASE WHEN dp.id IS NULL THEN CASE WHEN now()>d.date_remise THEN 'non_rendu' ELSE 'a_faire' END WHEN dp.note IS NOT NULL THEN 'note' WHEN dp.en_retard THEN 'en_retard' ELSE 'rendu' END`;
const D_JOIN = `FROM devoirs d JOIN matieres m ON m.id=d.matiere_id JOIN classes c ON c.id=d.classe_id`;
const D_COLS = `d.id,d.titre,d.description,d.matiere_id,d.classe_id,d.enseignant_id,d.date_remise,d.bareme,d.fichiers,d.annee_scolaire,d.created_at, m.nom AS matiere_nom, ${CLASSE_NOM('c')} AS classe_nom,
  CASE WHEN d.correction IS NOT NULL AND now()>d.date_remise THEN d.correction END AS correction, (d.correction IS NOT NULL) AS a_correction`;

devoirs.get('/', ah(async (req, res) => {
  const u = req.user;
  if (u.role === 'parent' || u.role === 'eleve') {
    const mine = await eleveIdsOf(u);
    const eid = Number(req.query.eleve_id || mine[0]);
    if (!mine.includes(eid)) throw new HttpError(403, 'Accès refusé');
    const { rows } = await q(
      `SELECT ${D_COLS}, dp.id AS depot_id, dp.deposited_at, dp.fichiers AS depot_fichiers, dp.en_retard, dp.note, dp.commentaire, (v.vu_at IS NOT NULL) AS vu, ${STATUT} AS statut
       ${D_JOIN} JOIN eleves e ON e.classe_id=d.classe_id AND e.id=$1
       LEFT JOIN depots dp ON dp.devoir_id=d.id AND dp.eleve_id=e.id LEFT JOIN devoir_vus v ON v.devoir_id=d.id AND v.eleve_id=e.id AND v.parent_id=$2
       WHERE d.deleted_at IS NULL AND d.annee_scolaire=$3 ORDER BY d.date_remise DESC`, [eid, u.role === 'parent' ? u.id : 0, config.anneeCourante]);
    return res.json(rows);
  }
  if (!['admin', 'enseignant'].includes(u.role)) throw new HttpError(403, 'Accès refusé');
  const params = [config.anneeCourante];
  const p = (v) => { params.push(v); return '$' + params.length; };
  let extra = u.role === 'enseignant' ? ` AND ${teachSql(p, u, 'd.classe_id', 'd.matiere_id')}` : '';
  if (req.query.classe_id) extra += ` AND d.classe_id=${p(req.query.classe_id)}`;
  const { rows } = await q(
    `SELECT ${D_COLS}, (SELECT COUNT(*) FROM depots x WHERE x.devoir_id=d.id) AS nb_depots, (SELECT COUNT(*) FROM eleves e WHERE e.classe_id=d.classe_id AND e.deleted_at IS NULL) AS nb_eleves
     ${D_JOIN} WHERE d.deleted_at IS NULL AND d.annee_scolaire=$1${extra} ORDER BY d.date_remise DESC`, params);
  res.json(rows);
}));

async function ownDevoir(req) {
  const d = (await q('SELECT * FROM devoirs WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
  if (!d) throw new HttpError(404, 'Devoir introuvable');
  if (!(await teacherCanTeach(req.user, d.classe_id, d.matiere_id))) throw new HttpError(403, 'Accès refusé');
  return d;
}
// Date de remise : valide, dans le futur, au plus un an plus tard
function dateRemise(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Date de remise invalide');
  if (d.getTime() <= Date.now()) throw new HttpError(400, 'La date de remise doit être dans le futur');
  if (d.getTime() > Date.now() + 366 * 864e5) throw new HttpError(400, 'La date de remise ne peut pas dépasser un an');
}
devoirs.post('/', allow('admin', 'enseignant'), upload.array('fichiers', 5), ah(async (req, res) => {
  const b = req.body;
  if (!b.titre || !b.matiere_id || !b.classe_id || !b.date_remise) throw new HttpError(400, 'Titre, matière, classe et date de remise obligatoires');
  b.titre = V.libelle(b.titre, 'Le titre', { required: true, max: 120 });
  b.description = V.texte(b.description, 'La description', { max: 2000, multiligne: true });
  b.bareme = V.nombre(b.bareme ?? 20, 'Le barème', { min: 1, max: 100, required: true });
  dateRemise(b.date_remise);
  if (!(await teacherCanTeach(req.user, b.classe_id, b.matiere_id))) throw new HttpError(403, "Vous n'enseignez pas cette matière dans cette classe");
  const d = (await q(`INSERT INTO devoirs(titre,description,matiere_id,classe_id,enseignant_id,date_remise,bareme,fichiers,annee_scolaire) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [b.titre, b.description || null, b.matiere_id, b.classe_id, req.user.id, b.date_remise, b.bareme || 20, JSON.stringify(filesInfo(req.files)), config.anneeCourante])).rows[0];
  await audit(null, req.user, 'create', 'devoirs', d.id, null, d);
  notify(await classAudience(d.classe_id), { type: 'devoir', titre: `Nouveau devoir : ${d.titre}`, corps: `À rendre avant le ${new Date(d.date_remise).toLocaleDateString('fr-FR')}`, lien: '/devoirs' }).catch(() => {});
  res.status(201).json(d);
}));
devoirs.put('/:id(\\d+)', allow('admin', 'enseignant'), upload.array('fichiers', 5), ah(async (req, res) => {
  const old = await ownDevoir(req);
  const b = req.body;
  if (b.titre !== undefined) b.titre = V.libelle(b.titre, 'Le titre', { required: true, max: 120 });
  if (b.description !== undefined) b.description = V.texte(b.description, 'La description', { max: 2000, multiligne: true });
  if (b.bareme !== undefined && b.bareme !== '') b.bareme = V.nombre(b.bareme, 'Le barème', { min: 1, max: 100, required: true });
  if (b.date_remise && new Date(b.date_remise).getTime() !== new Date(old.date_remise).getTime()) dateRemise(b.date_remise);
  let files = old.fichiers;
  if (b.remove_files) { const rm = JSON.parse(b.remove_files); for (const n of rm) await removeFile(n); files = files.filter((f) => !rm.includes(f.name)); }
  files = [...files, ...filesInfo(req.files)];
  const d = (await q(`UPDATE devoirs SET titre=$1, description=$2, date_remise=$3, bareme=$4, fichiers=$5 WHERE id=$6 RETURNING *`,
    [b.titre || old.titre, b.description ?? old.description, b.date_remise || old.date_remise, b.bareme || old.bareme, JSON.stringify(files), old.id])).rows[0];
  await audit(null, req.user, 'update', 'devoirs', d.id, old, d);
  res.json(d);
}));
devoirs.delete('/:id(\\d+)', allow('admin', 'enseignant'), ah(async (req, res) => {
  const d = await ownDevoir(req);
  const n = (await q('SELECT COUNT(*) n FROM depots WHERE devoir_id=$1', [d.id])).rows[0].n;
  if (n > 0 && req.query.force !== 'true') throw new HttpError(409, `${n} travail(aux) déjà déposé(s). Supprimer quand même ?`, { confirmable: true });
  await tx(async (cl) => {
    await cl.query('UPDATE devoirs SET deleted_at=now() WHERE id=$1', [d.id]);
    await audit(cl, req.user, 'delete', 'devoirs', d.id, d, null);
  });
  res.json({ ok: true });
}));
devoirs.post('/:id(\\d+)/correction', allow('admin', 'enseignant'), upload.single('correction'), ah(async (req, res) => {
  const d = await ownDevoir(req);
  if (!req.file) throw new HttpError(400, 'Fichier de correction requis');
  const info = filesInfo([req.file])[0];
  await q('UPDATE devoirs SET correction=$1 WHERE id=$2', [JSON.stringify(info), d.id]);
  await audit(null, req.user, 'update', 'devoirs', d.id, { correction: d.correction }, { correction: info });
  notify(await classAudience(d.classe_id), { type: 'correction', titre: `Correction disponible : ${d.titre}`, corps: 'Visible après la date de remise.', lien: '/devoirs' }).catch(() => {});
  res.json({ ok: true, correction: info });
}));
devoirs.get('/:id(\\d+)/depots', allow('admin', 'enseignant'), ah(async (req, res) => {
  const d = await ownDevoir(req);
  const { rows } = await q(
    `SELECT e.id AS eleve_id, e.nom, e.prenom, dp.id AS depot_id, dp.fichiers, dp.deposited_at, dp.en_retard, dp.note, dp.commentaire,
       CASE WHEN dp.id IS NULL THEN 'non_rendu' WHEN dp.note IS NOT NULL THEN 'note' WHEN dp.en_retard THEN 'en_retard' ELSE 'rendu' END AS statut
     FROM eleves e LEFT JOIN depots dp ON dp.eleve_id=e.id AND dp.devoir_id=$1 WHERE e.classe_id=$2 AND e.deleted_at IS NULL ORDER BY e.nom, e.prenom`, [d.id, d.classe_id]);
  res.json({ devoir: d, depots: rows });
}));
devoirs.post('/:id(\\d+)/depot', allow('eleve'), upload.array('fichiers', 5), ah(async (req, res) => {
  const d = (await q('SELECT * FROM devoirs WHERE id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0];
  const e = (await q('SELECT id FROM eleves WHERE user_id=$1 AND classe_id=$2 AND deleted_at IS NULL', [req.user.id, d?.classe_id])).rows[0];
  if (!d || !e) throw new HttpError(404, 'Devoir introuvable');
  if (!req.files?.length) throw new HttpError(400, 'Joignez au moins un fichier');
  const files = filesInfo(req.files);
  const old = (await q('SELECT * FROM depots WHERE devoir_id=$1 AND eleve_id=$2', [d.id, e.id])).rows[0];
  const late = new Date() > new Date(d.date_remise);
  if (old) {
    if (late) throw new HttpError(403, 'La date de remise est dépassée : le dépôt ne peut plus être modifié');
    if (old.note !== null) throw new HttpError(403, 'Ce travail a déjà été noté');
    for (const f of old.fichiers) await removeFile(f.name);
    await q('UPDATE depots SET fichiers=$1, deposited_at=now() WHERE id=$2', [JSON.stringify(files), old.id]);
  } else {
    await q('INSERT INTO depots(devoir_id,eleve_id,fichiers,en_retard) VALUES ($1,$2,$3,$4)', [d.id, e.id, JSON.stringify(files), late]);
  }
  notify([d.enseignant_id], { type: 'depot', titre: `Travail déposé : ${d.titre}`, corps: `${req.user.prenom} ${req.user.nom}${late ? ' (en retard)' : ''}`, lien: '/devoirs' }).catch(() => {});
  res.json({ ok: true, en_retard: late });
}));
// Note + commentaire d'un travail rendu
devoirs.put('/depots/:id(\\d+)', allow('admin', 'enseignant'), ah(async (req, res) => {
  const dp = (await q('SELECT dp.*, d.titre, d.bareme, d.classe_id, d.matiere_id FROM depots dp JOIN devoirs d ON d.id=dp.devoir_id WHERE dp.id=$1', [req.params.id])).rows[0];
  if (!dp) throw new HttpError(404, 'Dépôt introuvable');
  if (!(await teacherCanTeach(req.user, dp.classe_id, dp.matiere_id))) throw new HttpError(403, 'Accès refusé');
  const v = Number(String(req.body.note).replace(',', '.'));
  if (!Number.isFinite(v) || v < 0 || v > dp.bareme) throw new HttpError(400, `Note invalide (0 à ${dp.bareme})`);
  if (Math.abs(v * 4 - Math.round(v * 4)) > 1e-9) throw new HttpError(400, 'Note invalide : par pas de 0,25 (ex. 12 ; 12,25 ; 12,5)');
  req.body.commentaire = V.texte(req.body.commentaire, 'Le commentaire', { max: 500 });
  await q('UPDATE depots SET note=$1, commentaire=$2, note_publiee=TRUE WHERE id=$3', [v, req.body.commentaire || null, dp.id]);
  await audit(null, req.user, 'update', 'depots', dp.id, { note: dp.note, commentaire: dp.commentaire }, { note: v, commentaire: req.body.commentaire });
  const ids = [(await q('SELECT user_id FROM eleves WHERE id=$1', [dp.eleve_id])).rows[0]?.user_id, ...(await q('SELECT parent_id FROM eleve_parents WHERE eleve_id=$1', [dp.eleve_id])).rows.map((r) => r.parent_id)];
  notify(ids, { type: 'note', titre: `Note publiée : ${dp.titre}`, corps: `${v} / ${dp.bareme}`, lien: '/devoirs' }).catch(() => {});
  res.json({ ok: true });
}));
devoirs.post('/:id(\\d+)/vu', allow('parent'), ah(async (req, res) => {
  const eid = Number(req.body.eleve_id);
  if (!(await eleveIdsOf(req.user)).includes(eid)) throw new HttpError(403, 'Accès refusé');
  await q('INSERT INTO devoir_vus(devoir_id,eleve_id,parent_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [req.params.id, eid, req.user.id]);
  res.json({ ok: true });
}));

// ===================== Tableau de bord =====================
const dashboard = express.Router();
dashboard.get('/', ah(async (req, res) => {
  const u = req.user, a = config.anneeCourante, one = async (s, p = []) => (await q(s, p)).rows[0];
  if (u.role === 'admin' || u.role === 'comptable') {
    const [el, cl, en, pm, pre, imp] = await Promise.all([
      one("SELECT COUNT(*) n FROM eleves WHERE deleted_at IS NULL AND statut='actif'"),
      one('SELECT COUNT(*) n FROM classes WHERE deleted_at IS NULL AND annee_scolaire=$1', [a]),
      one("SELECT COUNT(*) n FROM users WHERE role='enseignant' AND deleted_at IS NULL"),
      one("SELECT COALESCE(SUM(montant),0) n FROM paiements WHERE deleted_at IS NULL AND date_trunc('month',date_paiement)=date_trunc('month',CURRENT_DATE)"),
      one("SELECT COUNT(*) n FROM preinscriptions WHERE statut='en_attente' AND deleted_at IS NULL"),
      require('../services/finance').impayes(a),
    ]);
    return res.json({ role: u.role, annee: a, eleves: el.n, classes: cl.n, enseignants: en.n, paiements_mois: pm.n, preinscriptions_attente: pre.n, impayes: imp.length, total_impaye: imp.reduce((s, i) => s + i.solde, 0) });
  }
  if (u.role === 'enseignant') {
    const p = []; const pp = (v) => { p.push(v); return '$' + p.length; };
    const [cl, dv, cr] = await Promise.all([
      one(`SELECT COUNT(*) n FROM classes WHERE deleted_at IS NULL AND annee_scolaire=${pp(a)} AND (titulaire_id=${pp(u.id)} OR id IN (SELECT classe_id FROM affectations WHERE enseignant_id=${pp(u.id)} AND deleted_at IS NULL))`, p),
      one('SELECT COUNT(*) n FROM devoirs WHERE enseignant_id=$1 AND deleted_at IS NULL AND date_remise>now()', [u.id]),
      one('SELECT COUNT(*) n FROM creneaux WHERE enseignant_id=$1 AND deleted_at IS NULL AND jour=$2 AND annee_scolaire=$3', [u.id, new Date().getDay() || 7, a]),
    ]);
    return res.json({ role: u.role, annee: a, classes: cl.n, devoirs_en_cours: dv.n, cours_aujourdhui: cr.n });
  }
  const ids = await eleveIdsOf(u);
  const enfants = [];
  for (const id of ids) {
    const e = await one(`SELECT e.id,e.nom,e.prenom,${CLASSE_NOM('c')} AS classe_nom FROM eleves e LEFT JOIN classes c ON c.id=e.classe_id WHERE e.id=$1`, [id]);
    const dv = await one('SELECT COUNT(*) n FROM devoirs d JOIN eleves x ON x.classe_id=d.classe_id AND x.id=$1 WHERE d.deleted_at IS NULL AND d.date_remise>now() AND NOT EXISTS (SELECT 1 FROM depots p WHERE p.devoir_id=d.id AND p.eleve_id=x.id)', [id]);
    enfants.push({ ...e, devoirs_a_rendre: dv.n, solde: u.role === 'parent' ? (await solde(id, a))?.solde : undefined });
  }
  res.json({ role: u.role, annee: a, enfants });
}));

module.exports = { messages, annonces, devoirs, dashboard };
