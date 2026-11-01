const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { qa, end } = require('./db');
const config = require('./config');

const sql = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const slugify = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'ecole';

// Les fichiers déjà envoyés (dossier à plat) rejoignent le dossier de la première école : uploads/<school_id>/
function rangerFichiers(schoolId) {
  try {
    const dir = config.uploadDir;
    fs.mkdirSync(path.join(dir, String(schoolId)), { recursive: true });
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (f.isFile() && f.name !== '.gitkeep') fs.renameSync(path.join(dir, f.name), path.join(dir, String(schoolId), f.name));
    }
  } catch (e) { console.warn('[migrate] Rangement des fichiers ignoré :', e.message); }
}

async function migrate() {
  await qa(sql('schema.sql'));
  // École par défaut : reçoit les données existantes avant le passage en multi-écoles
  await qa("INSERT INTO schools(nom, slug, status) SELECT $1, $2, 'active' WHERE NOT EXISTS (SELECT 1 FROM schools)", [config.ecoleNom, slugify(config.ecoleNom)]);
  try {
    await qa(sql('tenant.sql'));
  } catch (e) {
    throw new Error(`Isolation entre écoles impossible : ${e.message}\n` +
      "L'utilisateur PostgreSQL de l'application doit pouvoir créer un rôle (superutilisateur ou droit CREATEROLE).");
  }
  const school = (await qa('SELECT id FROM schools ORDER BY id LIMIT 1')).rows[0];
  rangerFichiers(school.id);

  // Premier administrateur de l'école par défaut
  if (!(await qa("SELECT 1 FROM users WHERE role='admin' AND deleted_at IS NULL LIMIT 1")).rowCount && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    await qa("INSERT INTO users(email,password_hash,role,nom,prenom,school_id) VALUES ($1,$2,'admin',$3,$4,$5) ON CONFLICT (email) DO NOTHING",
      [process.env.ADMIN_EMAIL.toLowerCase(), await bcrypt.hash(process.env.ADMIN_PASSWORD, 12), process.env.ADMIN_NOM || 'Direction', process.env.ADMIN_PRENOM || 'École', school.id]);
    console.log(`[migrate] Administrateur créé : ${process.env.ADMIN_EMAIL}`);
  }
  // Compte super-administrateur (propriétaire de la plateforme), séparé des directeurs d'école
  if (!(await qa("SELECT 1 FROM users WHERE role='superadmin' AND deleted_at IS NULL LIMIT 1")).rowCount) {
    if (process.env.SUPERADMIN_EMAIL && process.env.SUPERADMIN_PASSWORD) {
      await qa("INSERT INTO users(email,password_hash,role,nom,prenom,school_id) VALUES ($1,$2,'superadmin','Plateforme','Super-administrateur',NULL) ON CONFLICT (email) DO NOTHING",
        [process.env.SUPERADMIN_EMAIL.toLowerCase(), await bcrypt.hash(process.env.SUPERADMIN_PASSWORD, 12)]);
      console.log(`[migrate] Super-administrateur créé : ${process.env.SUPERADMIN_EMAIL}`);
    } else console.warn('[migrate] Aucun super-administrateur : définissez SUPERADMIN_EMAIL et SUPERADMIN_PASSWORD pour gérer les écoles.');
  }
  console.log('[migrate] Schéma à jour.');
}

module.exports = migrate;
module.exports.slugify = slugify;
if (require.main === module) migrate().then(() => end()).catch((e) => { console.error(e.message); process.exit(1); });
