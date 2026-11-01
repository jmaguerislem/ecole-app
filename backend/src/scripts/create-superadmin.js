// Usage : npm run superadmin -- email@exemple.tn "MotDePasse1"
const bcrypt = require('bcryptjs');
const { qa, end } = require('../db');
const V = require('../services/validate');
(async () => {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) throw new Error('Usage : npm run superadmin -- email motdepasse');
  const e = V.email(email); V.motDePasse(password);
  await qa("INSERT INTO users(email,password_hash,role,nom,prenom,school_id) VALUES ($1,$2,'superadmin','Plateforme','Super-administrateur',NULL) ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, role='superadmin', school_id=NULL, actif=TRUE",
    [e, await bcrypt.hash(password, 12)]);
  console.log(`Super-administrateur prêt : ${e}`);
})().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => end());
