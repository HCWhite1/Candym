-- ============================================================
-- Radar Alternance — schéma de la base SQLite
-- ============================================================

CREATE TABLE IF NOT EXISTS entreprises (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nom             TEXT NOT NULL,
  activite        TEXT NOT NULL DEFAULT '',
  ville           TEXT NOT NULL DEFAULT '',
  cp              TEXT NOT NULL DEFAULT '',
  adresse         TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL DEFAULT '',
  tel             TEXT NOT NULL DEFAULT '',
  url             TEXT NOT NULL DEFAULT '',
  pertinence      TEXT NOT NULL DEFAULT ''
                  CHECK (pertinence IN ('', 'haute', 'moyenne', 'faible')),
  pertinence_note TEXT NOT NULL DEFAULT '',
  statut          TEXT NOT NULL DEFAULT 'a_contacter'
                  CHECK (statut IN ('a_evaluer','a_contacter','contacte','relancee','piste','acceptee','refusee','fermee')),
  note            TEXT NOT NULL DEFAULT '',
  reponse         INTEGER NOT NULL DEFAULT 0,          -- 0/1 : une réponse a été reçue depuis le dernier contact
  contact_nom     TEXT NOT NULL DEFAULT '',            -- interlocuteur (recruteur, RH…)
  contact_poste   TEXT NOT NULL DEFAULT '',
  date_entretien  TEXT NOT NULL DEFAULT '',            -- ISO 8601 local (AAAA-MM-JJTHH:MM) ou vide
  siren           TEXT NOT NULL DEFAULT '',            -- rempli par l'enrichissement Recherche d'entreprises
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Historique des échanges avec une entreprise (contacts, relances, réponses)
CREATE TABLE IF NOT EXISTS historique (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entreprise_id INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  date          TEXT NOT NULL,                          -- ISO 8601
  type          TEXT NOT NULL CHECK (type IN ('contact','relance','reponse','note')),
  moyen         TEXT NOT NULL DEFAULT '',               -- Mail, Tél, Formulaire, Sur place…
  note          TEXT NOT NULL DEFAULT '',
  template_id   INTEGER REFERENCES templates(id) ON DELETE SET NULL  -- modèle utilisé pour un envoi
);
CREATE INDEX IF NOT EXISTS idx_historique_entreprise ON historique(entreprise_id, date);

-- Étiquettes libres ("Annonce active", "Incertain : réévaluer"…)
CREATE TABLE IF NOT EXISTS tags (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entreprise_id INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  label         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tags_entreprise ON tags(entreprise_id);

-- Modèles de message (variables : {entreprise} {ville} {activite} {interlocuteur} {moi.nom} {moi.tel} {moi.email})
CREATE TABLE IF NOT EXISTS templates (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body    TEXT NOT NULL DEFAULT '',
  kind    TEXT NOT NULL DEFAULT 'autre' CHECK (kind IN ('candidature', 'relance', 'autre'))
);

-- Coffre à documents : le fichier lui-même est rangé dans db/coffre/ sous son empreinte
-- SHA-256 (src/coffre.js) ; la base et ses sauvegardes n'en gardent que l'empreinte.
CREATE TABLE IF NOT EXISTS documents (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL,
  type     TEXT NOT NULL DEFAULT '',
  size     INTEGER NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  hash     TEXT NOT NULL DEFAULT ''     -- empreinte SHA-256 du contenu = nom du fichier dans db/coffre/
);

-- Réglages clé/valeur (delai_relance, configuration mail_* / smtp_*…).
-- Les mots de passe n'y sont pas : ils vivent dans le Gestionnaire d'identifiants Windows.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Notifications : une entrée par réponse d'entreprise détectée dans la boîte mail
CREATE TABLE IF NOT EXISTS notifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entreprise_id INTEGER REFERENCES entreprises(id) ON DELETE SET NULL,
  classement    TEXT CHECK (classement IN ('piste','acceptee','refusee') OR classement IS NULL),
  auto          INTEGER NOT NULL DEFAULT 0,   -- 1 si le classement vient de l'analyse automatique
  from_email    TEXT NOT NULL DEFAULT '',
  subject       TEXT NOT NULL DEFAULT '',
  snippet       TEXT NOT NULL DEFAULT '',
  mail_date     TEXT,
  message_id    TEXT,                          -- Message-ID du mail, pour dédupliquer
  motifs        TEXT NOT NULL DEFAULT '',     -- JSON : expressions qui ont décidé du classement automatique
  is_read       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read, created_at);

-- File d'envoi SMTP : un mail par ligne, envoyé par le serveur à l'heure prévue
CREATE TABLE IF NOT EXISTS outbox (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entreprise_id INTEGER REFERENCES entreprises(id) ON DELETE SET NULL,
  template_id   INTEGER REFERENCES templates(id) ON DELETE SET NULL,
  to_email      TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  attachments   TEXT NOT NULL DEFAULT '[]',   -- ids de documents du coffre (JSON)
  send_at       TEXT NOT NULL,                -- ISO 8601 UTC
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  error         TEXT NOT NULL DEFAULT '',
  message_id    TEXT,
  sent_at       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox(status, send_at);
