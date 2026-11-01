// Accès base de données avec isolation par école.
//  - `q` / `tx`  : pool applicatif. Chaque requête s'exécute avec le rôle restreint `ecole_app` et l'école de la session
//                  (variable `app.school_id`) : PostgreSQL (Row Level Security) filtre alors toutes les lignes.
//  - `qa` / `txa`: pool « propriétaire » qui contourne la RLS. Réservé à la connexion, aux migrations et au super-administrateur.
const { AsyncLocalStorage } = require('node:async_hooks');
const { Pool, types } = require('pg');
const c = require('./config');

types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v))); // numeric -> number
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10))); // bigint (count) -> number
types.setTypeParser(1082, (v) => v); // date -> 'YYYY-MM-DD' (pas de décalage de fuseau)

const mk = () => new Pool({ connectionString: c.databaseUrl, ssl: c.dbSsl ? { rejectUnauthorized: false } : undefined });
const adminPool = mk();
const appPool = mk();
const als = new AsyncLocalStorage(); // { schoolId, schoolNom } de la requête en cours
const APP_ROLE = 'ecole_app';

const schoolIdOf = (s) => (s && Number.isInteger(Number(s.schoolId)) && Number(s.schoolId) > 0 ? String(Number(s.schoolId)) : '');
// Une seule requête (protocole simple) : rôle restreint + école. Si le rôle manque, la requête échoue (jamais d'accès non filtré).
const prelude = (s, local) => `SET ${local ? 'LOCAL ' : ''}ROLE ${APP_ROLE}; SELECT set_config('app.school_id', '${schoolIdOf(s)}', ${local ? 'true' : 'false'})`;

async function q(text, params) {
  const s = als.getStore();
  const client = await appPool.connect();
  try {
    await client.query(prelude(s, false));
    return await client.query(text, params);
  } finally { client.release(); }
}
async function tx(fn) {
  const s = als.getStore();
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(prelude(s, true));
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}
const qa = (text, params) => adminPool.query(text, params);
async function txa(fn) {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}

const runWith = (store, fn) => als.run(store, fn); // exécute `fn` pour une école donnée (requête, tâche de fond, seed…)
const currentSchool = () => als.getStore() || null;
const end = () => Promise.all([adminPool.end(), appPool.end()]);

module.exports = { q, tx, qa, txa, runWith, currentSchool, end, pool: adminPool };
