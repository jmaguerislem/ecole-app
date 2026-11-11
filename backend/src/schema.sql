-- ===== MULTI-ÉCOLES : chaque école est une ligne de `schools` =====
CREATE TABLE IF NOT EXISTS schools (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','suspended')),
  plan TEXT NOT NULL DEFAULT 'basic' CHECK (plan IN ('basic','standard','premium')),
  subscription_end DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Schéma PostgreSQL – application mono-école (idempotent)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','enseignant','parent','eleve','comptable')),
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL,
  telephone TEXT,
  specialite TEXT,
  actif BOOLEAN NOT NULL DEFAULT TRUE,
  consentement_rgpd_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS classes (
  id SERIAL PRIMARY KEY,
  niveau TEXT NOT NULL,
  section TEXT,
  capacite INT NOT NULL DEFAULT 25 CHECK (capacite > 0),
  titulaire_id INT REFERENCES users(id),
  annee_scolaire TEXT NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matieres (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL,
  coefficient NUMERIC(4,2) NOT NULL DEFAULT 1 CHECK (coefficient > 0),
  niveau TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS affectations (
  id SERIAL PRIMARY KEY,
  enseignant_id INT NOT NULL REFERENCES users(id),
  matiere_id INT NOT NULL REFERENCES matieres(id),
  classe_id INT NOT NULL REFERENCES classes(id),
  annee_scolaire TEXT NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_affectations ON affectations(enseignant_id, matiere_id, classe_id, annee_scolaire) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS salles (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL,
  capacite INT,
  disponible BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS eleves (
  id SERIAL PRIMARY KEY,
  matricule TEXT,
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL,
  date_naissance DATE,
  sexe TEXT CHECK (sexe IN ('M','F')),
  adresse TEXT,
  photo TEXT,
  antecedents_medicaux TEXT,
  annee_entree TEXT,
  classe_id INT REFERENCES classes(id),
  user_id INT REFERENCES users(id),
  statut TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif','inactif','diplome')),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eleves_classe ON eleves(classe_id);

CREATE TABLE IF NOT EXISTS eleve_parents (
  eleve_id INT NOT NULL REFERENCES eleves(id) ON DELETE CASCADE,
  parent_id INT NOT NULL REFERENCES users(id),
  lien TEXT,
  PRIMARY KEY (eleve_id, parent_id)
);

CREATE TABLE IF NOT EXISTS preinscriptions (
  id SERIAL PRIMARY KEY,
  annee_scolaire TEXT NOT NULL,
  eleve_nom TEXT NOT NULL,
  eleve_prenom TEXT NOT NULL,
  date_naissance DATE NOT NULL,
  sexe TEXT CHECK (sexe IN ('M','F')),
  niveau_souhaite TEXT,
  parent_nom TEXT NOT NULL,
  parent_prenom TEXT NOT NULL,
  parent_email TEXT NOT NULL,
  parent_telephone TEXT,
  adresse TEXT,
  antecedents_medicaux TEXT,
  consentement_rgpd BOOLEAN NOT NULL DEFAULT FALSE,
  statut TEXT NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente','validee','refusee')),
  motif_refus TEXT,
  eleve_id INT REFERENCES eleves(id),
  traitee_par INT REFERENCES users(id),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS creneaux (
  id SERIAL PRIMARY KEY,
  classe_id INT NOT NULL REFERENCES classes(id),
  matiere_id INT NOT NULL REFERENCES matieres(id),
  enseignant_id INT NOT NULL REFERENCES users(id),
  salle_id INT REFERENCES salles(id),
  jour SMALLINT NOT NULL CHECK (jour BETWEEN 1 AND 6),
  heure_debut TIME NOT NULL,
  heure_fin TIME NOT NULL,
  annee_scolaire TEXT NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (heure_fin > heure_debut)
);

CREATE TABLE IF NOT EXISTS evaluations (
  id SERIAL PRIMARY KEY,
  classe_id INT NOT NULL REFERENCES classes(id),
  matiere_id INT NOT NULL REFERENCES matieres(id),
  titre TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'controle_continu' CHECK (type IN ('controle_continu','examen_trimestriel')),
  trimestre SMALLINT NOT NULL DEFAULT 1 CHECK (trimestre BETWEEN 1 AND 3),
  date_eval DATE,
  bareme NUMERIC(5,2) NOT NULL DEFAULT 20 CHECK (bareme > 0),
  annee_scolaire TEXT NOT NULL,
  created_by INT REFERENCES users(id),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notes (
  id SERIAL PRIMARY KEY,
  evaluation_id INT NOT NULL REFERENCES evaluations(id),
  eleve_id INT NOT NULL REFERENCES eleves(id),
  valeur NUMERIC(5,2) NOT NULL CHECK (valeur >= 0),
  commentaire TEXT,
  annee_scolaire TEXT NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notes ON notes(evaluation_id, eleve_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS absences (
  id SERIAL PRIMARY KEY,
  eleve_id INT NOT NULL REFERENCES eleves(id),
  date_absence DATE NOT NULL,
  periode TEXT NOT NULL DEFAULT 'journee' CHECK (periode IN ('matin','apres_midi','journee')),
  motif TEXT,
  justifiee BOOLEAN NOT NULL DEFAULT FALSE,
  justification TEXT,
  annee_scolaire TEXT NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tarifs (
  id SERIAL PRIMARY KEY,
  annee_scolaire TEXT NOT NULL,
  libelle TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'scolarite' CHECK (type IN ('inscription','scolarite','tranche','autre')),
  niveau TEXT,
  montant NUMERIC(10,2) NOT NULL CHECK (montant >= 0),
  echeance DATE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS paiements (
  id SERIAL PRIMARY KEY,
  eleve_id INT NOT NULL REFERENCES eleves(id),
  tarif_id INT REFERENCES tarifs(id),
  montant NUMERIC(10,2) NOT NULL CHECK (montant > 0),
  mode TEXT NOT NULL CHECK (mode IN ('especes','virement','mobile_money')),
  date_paiement DATE NOT NULL DEFAULT CURRENT_DATE,
  reference TEXT,
  numero_recu TEXT,
  notes TEXT,
  annee_scolaire TEXT NOT NULL,
  created_by INT REFERENCES users(id),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_paiements_eleve ON paiements(eleve_id);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  sender_id INT NOT NULL REFERENCES users(id),
  thread_id INT REFERENCES messages(id),
  eleve_id INT REFERENCES eleves(id),
  objet TEXT NOT NULL,
  corps TEXT NOT NULL DEFAULT '',
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','envoye')),
  attachments JSONB NOT NULL DEFAULT '[]',
  draft_recipients JSONB NOT NULL DEFAULT '[]',
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS message_recipients (
  id SERIAL PRIMARY KEY,
  message_id INT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id),
  read_at TIMESTAMPTZ,
  hidden_at TIMESTAMPTZ,
  UNIQUE (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_mr_user ON message_recipients(user_id);

CREATE TABLE IF NOT EXISTS annonces (
  id SERIAL PRIMARY KEY,
  auteur_id INT NOT NULL REFERENCES users(id),
  titre TEXT NOT NULL,
  corps TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'tous' CHECK (audience IN ('tous','parents','enseignants','eleves')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devoirs (
  id SERIAL PRIMARY KEY,
  titre TEXT NOT NULL,
  description TEXT,
  matiere_id INT NOT NULL REFERENCES matieres(id),
  classe_id INT NOT NULL REFERENCES classes(id),
  enseignant_id INT REFERENCES users(id),
  date_remise TIMESTAMPTZ NOT NULL,
  bareme NUMERIC(5,2) NOT NULL DEFAULT 20,
  fichiers JSONB NOT NULL DEFAULT '[]',
  correction JSONB,
  annee_scolaire TEXT NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS depots (
  id SERIAL PRIMARY KEY,
  devoir_id INT NOT NULL REFERENCES devoirs(id),
  eleve_id INT NOT NULL REFERENCES eleves(id),
  fichiers JSONB NOT NULL DEFAULT '[]',
  deposited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  en_retard BOOLEAN NOT NULL DEFAULT FALSE,
  note NUMERIC(5,2),
  commentaire TEXT,
  note_publiee BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (devoir_id, eleve_id)
);
CREATE TABLE IF NOT EXISTS devoir_vus (
  devoir_id INT NOT NULL REFERENCES devoirs(id),
  eleve_id INT NOT NULL REFERENCES eleves(id),
  parent_id INT NOT NULL REFERENCES users(id),
  vu_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (devoir_id, eleve_id, parent_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  type TEXT,
  titre TEXT NOT NULL,
  corps TEXT,
  lien TEXT,
  lu BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, lu);
CREATE TABLE IF NOT EXISTS notification_log (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  canal TEXT NOT NULL,
  sujet TEXT,
  statut TEXT NOT NULL,
  erreur TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  keys JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  action TEXT NOT NULL,
  entite TEXT NOT NULL,
  entite_id INT,
  anciennes JSONB,
  nouvelles JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_entite ON audit_log(entite, entite_id);
CREATE TABLE IF NOT EXISTS access_log (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  ressource TEXT NOT NULL,
  ressource_id INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Évolutions : e-mail élève, annonces ciblées, historique des tarifs =====
-- 1) E-mail de l'élève : généré par le serveur, unique dans toute la base (insensible à la casse)
ALTER TABLE eleves ADD COLUMN IF NOT EXISTS email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_eleves_email ON eleves (lower(email)) WHERE email IS NOT NULL;

-- 2) Annonces : audience « personne » (destinataires choisis un par un)
ALTER TABLE annonces ADD COLUMN IF NOT EXISTS destinataire_ids INT[];
ALTER TABLE annonces DROP CONSTRAINT IF EXISTS annonces_audience_check;
ALTER TABLE annonces ADD CONSTRAINT annonces_audience_check CHECK (audience IN ('tous','parents','enseignants','eleves','personne'));

-- 3) Historique des tarifs : chaque création / modification / suppression / augmentation automatique est conservée
CREATE TABLE IF NOT EXISTS tarifs_historique (
  id SERIAL PRIMARY KEY,
  tarif_id INT REFERENCES tarifs(id),
  annee_scolaire TEXT NOT NULL,
  niveau TEXT,
  libelle TEXT NOT NULL,
  type TEXT,
  montant_ancien NUMERIC(10,2),
  montant_nouveau NUMERIC(10,2),
  motif TEXT NOT NULL CHECK (motif IN ('creation','modification','augmentation_auto','suppression')),
  user_id INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tarifs_hist_tarif ON tarifs_historique(tarif_id);
CREATE INDEX IF NOT EXISTS idx_tarifs_hist_niveau ON tarifs_historique(niveau, annee_scolaire);

-- 4) Informations administratives de l'école (renseignées à la création ; affichées dans la page Écoles)
ALTER TABLE schools ADD COLUMN IF NOT EXISTS ville TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS adresse TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS telephone TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS email_contact TEXT;

-- 5) Corrections de données appliquées UNE seule fois (évite de réécrire, à chaque démarrage, des valeurs modifiées depuis)
CREATE TABLE IF NOT EXISTS data_migrations (
  nom TEXT PRIMARY KEY,
  applique_le TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Évolutions : espace propriétaire (loyers), invitations parents, site partagé =====
-- 6) Contrat de location d'une école (une ligne par école). Données du PROPRIÉTAIRE : jamais accessibles aux comptes d'école (voir tenant.sql).
CREATE TABLE IF NOT EXISTS school_contracts (
  school_id INT PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  loyer_mensuel NUMERIC(10,2) NOT NULL CHECK (loyer_mensuel >= 0),
  jour_echeance SMALLINT NOT NULL DEFAULT 5 CHECK (jour_echeance BETWEEN 1 AND 28),
  date_debut DATE NOT NULL,
  date_fin DATE,
  caution NUMERIC(10,2) CHECK (caution IS NULL OR caution >= 0),
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (date_fin IS NULL OR date_fin >= date_debut)
);
-- 7) Échéances mensuelles (loyer PRÉVU) et encaissements (loyer RÉELLEMENT encaissé). Un revenu = une ligne de loyer_encaissements, jamais une échéance.
CREATE TABLE IF NOT EXISTS loyer_echeances (
  id SERIAL PRIMARY KEY,
  school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  periode DATE NOT NULL,              -- 1er jour du mois concerné
  echeance DATE NOT NULL,             -- date limite de paiement
  montant_du NUMERIC(10,2) NOT NULL CHECK (montant_du >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, periode)
);
CREATE TABLE IF NOT EXISTS loyer_encaissements (
  id SERIAL PRIMARY KEY,
  echeance_id INT NOT NULL REFERENCES loyer_echeances(id) ON DELETE CASCADE,
  school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  montant NUMERIC(10,2) NOT NULL CHECK (montant > 0),
  date_paiement DATE NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('especes','virement','cheque','mobile_money')),
  reference TEXT,
  notes TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loyer_ech_school ON loyer_echeances(school_id, periode);
CREATE INDEX IF NOT EXISTS idx_loyer_enc_ech ON loyer_encaissements(echeance_id);
-- 8) Site (bâtiment) de l'école : deux écoles du même site partagent leurs locaux (même nom de salle = même salle physique)
ALTER TABLE schools ADD COLUMN IF NOT EXISTS site TEXT;
-- 9) Invitations : jeton à usage unique pour définir son mot de passe (jamais de mot de passe envoyé par e-mail). Seul le hachage est stocké.
CREATE TABLE IF NOT EXISTS password_setup_tokens (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  essais SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pst_user ON password_setup_tokens(user_id);
-- Suivi de l'e-mail d'invitation (pour détecter les échecs d'envoi et proposer « Renvoyer »)
ALTER TABLE users ADD COLUMN IF NOT EXISTS invitation_envoyee_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invitation_erreur TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mot_de_passe_defini BOOLEAN NOT NULL DEFAULT TRUE;

-- ===== Évolutions : mot de passe temporaire, profil super-admin, début d'abonnement, comptes de démonstration =====
-- Compte créé avec un mot de passe temporaire (ex. parent) : l'utilisateur DOIT le changer à sa première connexion
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
-- Photo de profil (nom de fichier servi par /api/files/…, rangé dans uploads/<école>/ ou uploads/platform/ pour le super-administrateur)
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS subscription_start DATE;
UPDATE schools SET subscription_start = created_at::date WHERE subscription_start IS NULL;
ALTER TABLE schools ALTER COLUMN subscription_start SET DEFAULT CURRENT_DATE;
-- Comptes de démonstration de la page de connexion : (groupe 1..3, rôle) → vrai compte de la base. Aucun mot de passe n'est stocké ici.
CREATE TABLE IF NOT EXISTS demo_accounts (
  groupe INT NOT NULL CHECK (groupe BETWEEN 1 AND 3),
  role TEXT NOT NULL CHECK (role IN ('admin','comptable','eleve','parent','enseignant')),
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (groupe, role)
);
