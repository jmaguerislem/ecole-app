const { q, currentSchool } = require('./db');
const redact = (o) => { if (!o) return o; const { password_hash, ...rest } = o; return rest; };
async function audit(client, user, action, entite, id, anciennes, nouvelles) {
  if (!currentSchool()?.schoolId) return; // compte de la plateforme : pas de journal d'école
  const run = client ? client.query.bind(client) : q;
  await run(
    'INSERT INTO audit_log(user_id,action,entite,entite_id,anciennes,nouvelles) VALUES ($1,$2,$3,$4,$5,$6)',
    [user ? user.id : null, action, entite, id, anciennes ? JSON.stringify(redact(anciennes)) : null, nouvelles ? JSON.stringify(redact(nouvelles)) : null]
  );
}
module.exports = { audit };
