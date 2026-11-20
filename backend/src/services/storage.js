// Stockage de fichiers sur disque (monter un volume persistant en production).
// Pour passer à S3 : remplacer `upload` par multer-s3 et `sendFile` par une URL signée.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const db = require('../db');
const { HttpError } = require('../util');

fs.mkdirSync(config.uploadDir, { recursive: true });
const ALLOWED = /^(application\/pdf|image\/(png|jpe?g|gif|webp)|text\/plain|application\/(msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|vnd\.oasis\.opendocument\.text|vnd\.ms-excel))$/;

// Extensions admises pour chaque type. L'extension du fichier stocké vient de cette liste : un « .html » ou « .svg » déclaré text/plain
// serait sinon servi comme page web (script exécuté dans le site) lors de son ouverture.
const MIME_EXT = {
  'application/pdf': ['.pdf'], 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/jpg': ['.jpg', '.jpeg'], 'image/gif': ['.gif'], 'image/webp': ['.webp'],
  'text/plain': ['.txt'], 'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
  'application/vnd.oasis.opendocument.text': ['.odt'], 'application/vnd.ms-excel': ['.xls', '.csv'],
};
const extensionSure = (file) => {
  const liste = MIME_EXT[file.mimetype]; if (!liste) return null;
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ext) return liste[0]; // fichier sans extension : on lui donne celle de son type
  return liste.includes(ext) ? ext : null;
};
// Supprime les fichiers reçus par multer quand la requête est finalement refusée (sinon ils resteraient orphelins sur le disque)
const supprimerUploads = (req) => {
  const fichiers = [...(req.file ? [req.file] : []), ...(Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat())];
  return Promise.all(fichiers.map((f) => (f.path ? fs.promises.unlink(f.path).catch(() => {}) : null)));
};

// Chaque école a son dossier : uploads/<school_id>/
const schoolDir = (schoolId) => path.join(config.uploadDir, String(schoolId));
const raw = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      if (!req.user?.school_id) return cb(new HttpError(403, "Envoi de fichier impossible : aucune école"));
      const dir = schoolDir(req.user.school_id);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + (extensionSure(file) || '.bin')),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => (ALLOWED.test(file.mimetype) && extensionSure(file) ? cb(null, true) : cb(new HttpError(400, `Type de fichier non autorisé : ${Buffer.from(file.originalname || '', 'latin1').toString('utf8')} (l'extension ne correspond pas au type du fichier)`))),
});
// Photos : images uniquement, extension imposée par le type, signature du fichier vérifiée
const IMG = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const rawImg = multer({
  storage: multer.diskStorage({
    destination: (req, _f, cb) => {
      if (!req.user?.school_id) return cb(new HttpError(403, 'Envoi de fichier impossible : aucune école'));
      const dir = schoolDir(req.user.school_id); fs.mkdirSync(dir, { recursive: true }); cb(null, dir);
    },
    filename: (_r, file, cb) => cb(null, `${crypto.randomBytes(16).toString('hex')}.${IMG[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_r, file, cb) => (IMG[file.mimetype] ? cb(null, true) : cb(new HttpError(400, 'Photo : formats JPEG, PNG ou WebP uniquement'))),
});
// Photo de profil du super-administrateur : pas d'école, donc dossier uploads/platform/
const rawProfil = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => { const dir = path.join(config.uploadDir, 'platform'); fs.mkdirSync(dir, { recursive: true }); cb(null, dir); },
    filename: (_r, file, cb) => cb(null, `${crypto.randomBytes(16).toString('hex')}.${IMG[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_r, file, cb) => (IMG[file.mimetype] ? cb(null, true) : cb(new HttpError(400, 'Photo : formats JPEG, PNG ou WebP uniquement'))),
});
const removePlatformFile = (name) => fs.promises.unlink(path.join(config.uploadDir, 'platform', path.basename(name))).catch(() => {});
function imageValide(file) {
  const b = fs.readFileSync(file.path).subarray(0, 12);
  const ok = file.mimetype === 'image/jpeg' ? b[0] === 0xff && b[1] === 0xd8
    : file.mimetype === 'image/png' ? b.subarray(0, 4).toString('hex') === '89504e47'
      : b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';
  if (!ok) fs.unlinkSync(file.path);
  return ok;
}
const photoExiste = (name) => { const s = db.currentSchool(); return !!s?.schoolId && fs.existsSync(path.join(schoolDir(s.schoolId), path.basename(name))); };
const rawMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Multer termine son travail dans un autre contexte asynchrone : on rétablit l'école de la session avant la suite du traitement.
const withSchool = (mw) => (req, res, next) => mw(req, res, (err) => (err ? next(err) : db.runWith(req.tenant, next)));
const wrap = (m) => ({ array: (...a) => withSchool(m.array(...a)), single: (...a) => withSchool(m.single(...a)), fields: (...a) => withSchool(m.fields(...a)) });
const upload = wrap(raw);
const memUpload = wrap(rawMem);
const imageUpload = wrap(rawImg);
const profilUpload = wrap(rawProfil);

const fileInfo = (f) => ({ name: f.filename, original: Buffer.from(f.originalname, 'latin1').toString('utf8'), size: f.size, mime: f.mimetype });
const filesInfo = (arr) => (arr || []).map(fileInfo);
const removeFile = (name) => {
  const school = db.currentSchool();
  if (!school?.schoolId) return Promise.resolve();
  return fs.promises.unlink(path.join(schoolDir(school.schoolId), path.basename(name))).catch(() => {});
};

module.exports = { supprimerUploads, imageUpload, profilUpload, removePlatformFile, imageValide, photoExiste, upload, memUpload, fileInfo, filesInfo, removeFile };
