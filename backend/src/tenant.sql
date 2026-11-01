-- ===== ISOLATION ENTRE ÉCOLES (idempotent : relancé à chaque démarrage) =====
-- 1) Rôle applicatif restreint : il n'est ni superutilisateur ni autorisé à contourner la sécurité par ligne (RLS).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ecole_app') THEN
    CREATE ROLE ecole_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  BEGIN
    EXECUTE format('GRANT ecole_app TO %I', current_user);
  EXCEPTION WHEN OTHERS THEN NULL; -- inutile pour un superutilisateur
  END;
END $$;

-- 2) Rôle « super-administrateur » (compte de la plateforme, rattaché à aucune école)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','enseignant','parent','eleve','comptable','superadmin'));

-- 3) Garde-fou : une donnée ne peut jamais référencer une donnée d'une autre école (contraintes de clé étrangère comprises)
CREATE OR REPLACE FUNCTION enforce_same_school() RETURNS trigger LANGUAGE plpgsql AS $f$
DECLARE v INT; ok BOOLEAN;
BEGIN
  EXECUTE format('SELECT ($1).%I', TG_ARGV[0]) INTO v USING NEW;
  IF v IS NULL THEN RETURN NEW; END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND school_id = $2)', TG_ARGV[1]) INTO ok USING v, NEW.school_id;
  IF NOT ok THEN
    RAISE EXCEPTION 'Référence vers une autre école interdite (%.%)', TG_TABLE_NAME, TG_ARGV[0] USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $f$;

-- 4) school_id + filtre automatique (RLS) sur toutes les tables qui appartiennent à une école
DO $$
DECLARE
  t TEXT; s1 INT; fk RECORD;
  tenant TEXT[] := ARRAY['users','classes','matieres','affectations','salles','eleves','eleve_parents','preinscriptions',
    'creneaux','evaluations','notes','absences','tarifs','paiements','messages','message_recipients','annonces',
    'devoirs','depots','devoir_vus','notifications','notification_log','push_subscriptions','audit_log','access_log'];
  logs TEXT[] := ARRAY['audit_log','access_log','notification_log'];
  cond TEXT := $c$school_id = NULLIF(current_setting('app.school_id', true), '')::int$c$;
BEGIN
  SELECT MIN(id) INTO s1 FROM schools;  -- les données existantes avant la migration appartiennent à la première école
  FOREACH t IN ARRAY tenant LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS school_id INT REFERENCES schools(id)', t);
    IF t = 'users' THEN
      EXECUTE format('UPDATE users SET school_id = %s WHERE school_id IS NULL AND role <> ''superadmin''', s1);
    ELSE
      EXECUTE format('UPDATE %I SET school_id = %s WHERE school_id IS NULL', t, s1);
      IF NOT (t = ANY(logs)) THEN EXECUTE format('ALTER TABLE %I ALTER COLUMN school_id SET NOT NULL', t); END IF;
    END IF;
    -- l'école est ajoutée automatiquement à chaque création, depuis la session (jamais depuis la page)
    EXECUTE format($d$ALTER TABLE %I ALTER COLUMN school_id SET DEFAULT NULLIF(current_setting('app.school_id', true), '')::int$d$, t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(school_id)', 'idx_' || t || '_school', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS school_isolation ON %I', t);
    EXECUTE format('CREATE POLICY school_isolation ON %I USING (%s) WITH CHECK (%s)', t, cond, cond);
  END LOOP;

  FOR fk IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, c.confrelid::regclass::text AS reft
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
      AND c.conrelid::regclass::text = ANY(tenant) AND c.confrelid::regclass::text = ANY(tenant)
      AND NOT (c.conrelid::regclass::text = ANY(logs))
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_school_' || fk.col, fk.tbl);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION enforce_same_school(%L, %L)',
      'trg_school_' || fk.col, fk.tbl, fk.col, fk.reft);
  END LOOP;
END $$;

-- 5) Un compte appartient à une école, sauf le super-administrateur
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_school_role_check;
ALTER TABLE users ADD CONSTRAINT users_school_role_check CHECK ((role = 'superadmin') = (school_id IS NULL));

-- 6) Unicité PAR ÉCOLE (et non dans toute la base) : matricule des élèves, numéro de reçu
DROP INDEX IF EXISTS uq_eleves_matricule;
CREATE UNIQUE INDEX IF NOT EXISTS uq_eleves_matricule_school ON eleves(school_id, matricule) WHERE matricule IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_paiements_recu_school ON paiements(school_id, numero_recu) WHERE numero_recu IS NOT NULL;

-- 7) La table des écoles : un utilisateur d'école ne voit que SA ligne, en lecture seule
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS school_isolation ON schools;
CREATE POLICY school_isolation ON schools FOR SELECT USING (id = NULLIF(current_setting('app.school_id', true), '')::int);

-- 8) Droits du rôle applicatif
GRANT USAGE ON SCHEMA public TO ecole_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ecole_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ecole_app;
REVOKE INSERT, UPDATE, DELETE ON schools FROM ecole_app;
