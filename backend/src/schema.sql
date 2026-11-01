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
