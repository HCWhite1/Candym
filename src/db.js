// Connexion SQLite (module node:sqlite intégré à Node ≥ 22.5, aucune dépendance native).
// À la première exécution, la base est créée puis peuplée depuis db/*.sql ;
// ensuite, les migrations numérotées (PRAGMA user_version) font évoluer une base existante.
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "./coffre.js";

const DB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db");
// RADAR_DB_PATH : base alternative (tests automatisés uniquement)
const DB_PATH = process.env.RADAR_DB_PATH || path.join(DB_DIR, "radar.db");
const BACKUP_DIR = path.join(path.dirname(DB_PATH), "backups");
// Les sauvegardes sont faites avant une opération destructive, souvent en rafale (deux imports,
// puis une mise à jour de la base) : 5 suffisent à revenir avant la première.
const BACKUPS_KEPT = 5;

// Fichiers du coffre : à côté de la base, dans coffre/ (voir src/coffre.js)
export const coffre = createStore(path.join(path.dirname(DB_PATH), "coffre"));

const firstRun = !existsSync(DB_PATH);

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA journal_mode = WAL;");
// Une fenêtre fermée sans arrêt propre laisse un WAL plein : on le vide au démarrage.
db.exec("PRAGMA wal_checkpoint(TRUNCATE);");

const sqlFile = name => readFileSync(path.join(DB_DIR, name), "utf8");

// Chaque entrée (SQL, ou fonction quand il faut tester l'existant) fait passer la base de la version i à i+1.
// schema.sql décrit toujours le schéma final : une base neuve saute les migrations.
const MIGRATIONS = [
  // 1 — interlocuteur, entretien, SIREN ; type de modèle ; modèle utilisé par envoi ;
  //     variables {moi.*} à la place des trous [Prénom NOM]… ; URL sans schéma normalisées.
  `ALTER TABLE entreprises ADD COLUMN contact_nom TEXT NOT NULL DEFAULT '';
   ALTER TABLE entreprises ADD COLUMN contact_poste TEXT NOT NULL DEFAULT '';
   ALTER TABLE entreprises ADD COLUMN date_entretien TEXT NOT NULL DEFAULT '';
   ALTER TABLE entreprises ADD COLUMN siren TEXT NOT NULL DEFAULT '';
   ALTER TABLE templates ADD COLUMN kind TEXT NOT NULL DEFAULT 'autre'
     CHECK (kind IN ('candidature', 'relance', 'autre'));
   ALTER TABLE historique ADD COLUMN template_id INTEGER REFERENCES templates(id) ON DELETE SET NULL;
   UPDATE templates SET kind = 'relance' WHERE lower(name) LIKE 'relance%';
   UPDATE templates SET kind = 'candidature' WHERE kind = 'autre' AND (lower(name) LIKE '%candidature%' OR lower(name) LIKE '%annonce%');
   UPDATE templates SET
     subject = replace(replace(replace(subject, '[Prénom NOM]', '{moi.nom}'), '[Téléphone]', '{moi.tel}'), '[Email]', '{moi.email}'),
     body    = replace(replace(replace(body,    '[Prénom NOM]', '{moi.nom}'), '[Téléphone]', '{moi.tel}'), '[Email]', '{moi.email}');
   UPDATE entreprises SET url = 'https://' || url
     WHERE url != '' AND url NOT LIKE 'http://%' AND url NOT LIKE 'https://%' AND instr(url, ':') = 0;`,
  // 2 — motifs du classement automatique d'une réponse (JSON), affichés sous la notification.
  //     Une base antérieure aux notifications vient de recevoir la table complète via schema.sql.
  () => {
    const cols = db.prepare("PRAGMA table_info(notifications)").all().map(c => c.name);
    if (!cols.includes("motifs")) db.exec("ALTER TABLE notifications ADD COLUMN motifs TEXT NOT NULL DEFAULT '';");
  },
  // 3 — fichiers du coffre sortis de la base vers coffre/ (un fichier par contenu, jamais recopié
  //     dans les sauvegardes). La sauvegarde « avant-migration-3 » garde l'ancien format, fichiers compris.
  () => {
    const cols = db.prepare("PRAGMA table_info(documents)").all().map(c => c.name);
    if (!cols.includes("hash")) db.exec("ALTER TABLE documents ADD COLUMN hash TEXT NOT NULL DEFAULT '';");
    if (!cols.includes("content")) return;
    const read = db.prepare("SELECT content FROM documents WHERE id = ?");
    const set = db.prepare("UPDATE documents SET hash = ? WHERE id = ?");
    for (const { id } of db.prepare("SELECT id FROM documents").all()) {
      set.run(coffre.put(Buffer.from(read.get(id).content)), id);
    }
    db.exec("ALTER TABLE documents DROP COLUMN content;");
  },
];

// Réentrante : un appel imbriqué (insertEntreprise pendant un import) rejoint la transaction en cours.
let inTransaction = false;
export function transaction(fn) {
  if (inTransaction) return fn();
  db.exec("BEGIN");
  inTransaction = true;
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    inTransaction = false;
  }
}

// UPDATE partiel : seules les clés de `allowed` présentes dans `body` sont écrites.
// `allowed` associe la clé de l'API à { col, map? } (map convertit la valeur).
// Renvoie le nombre de colonnes modifiées.
export function patchRow(table, allowed, body, id) {
  const sets = [];
  const vals = [];
  // Conversion par défaut : texte, null devenant vide (String(null) écrirait « null » dans la base)
  for (const [key, { col, map = v => String(v ?? "") }] of Object.entries(allowed)) {
    if (body[key] === undefined) continue;
    sets.push(`${col} = ?`);
    vals.push(map(body[key]));
  }
  if (sets.length) db.prepare(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  return sets.length;
}

export function getSetting(key, fallback = null) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, String(value));
}

export function deleteSetting(key) {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
}

// Retire d'une copie de la base tout secret hérité des anciennes versions
// (mot de passe mail en clair), octets compris (secure_delete + VACUUM).
export function scrubSecrets(file) {
  const copy = new DatabaseSync(file);
  try {
    copy.exec("PRAGMA secure_delete = ON; DELETE FROM settings WHERE key = 'mail_pass'; VACUUM;");
  } finally {
    copy.close();
  }
}

// Copie intégrale de la base dans db/backups/ (via VACUUM INTO, sûr même base ouverte).
// Appelée avant toute opération destructive (import, reset, migration). Garde les BACKUPS_KEPT plus récentes.
// Les secrets n'y figurent pas : ils vivent dans le Gestionnaire d'identifiants Windows (src/secrets.js).
export function backupDb(label = "avant-operation") {
  // VACUUM INTO n'accepte pas de paramètre lié : l'étiquette entre dans le SQL, elle reste donc littérale.
  if (!/^[a-z0-9-]+$/.test(label)) throw new Error("Étiquette de sauvegarde invalide : " + label);
  const dir = BACKUP_DIR;
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  const file = path.join(dir, `radar-${stamp}-${label}.db`);
  if (!existsSync(file)) {
    db.exec(`VACUUM INTO '${file.replaceAll("\\", "/").replaceAll("'", "''")}'`);
    scrubSecrets(file);
  }
  const old = backupFiles().sort().reverse().slice(BACKUPS_KEPT);
  for (const f of old) rmSync(path.join(dir, f), { force: true });
  if (old.length) pruneCoffre(); // une sauvegarde retirée peut libérer des fichiers du coffre
  return file;
}

const backupFiles = () => (existsSync(BACKUP_DIR) ? readdirSync(BACKUP_DIR).filter(f => f.endsWith(".db")) : []);

// Empreintes citées par une base ; aucune pour l'ancien format (fichiers dans la base elle-même).
function hashesOf(database) {
  const cols = database.prepare("PRAGMA table_info(documents)").all().map(c => c.name);
  return cols.includes("hash") ? database.prepare("SELECT hash FROM documents").all().map(d => d.hash) : [];
}

// Supprime de coffre/ les fichiers que ni la base ni aucune sauvegarde ne citent :
// restaurer une sauvegarde doit toujours retrouver ses fichiers. Dans le doute
// (sauvegarde illisible), rien n'est supprimé. Renvoie le nombre de fichiers supprimés.
export function pruneCoffre() {
  const keep = new Set(hashesOf(db));
  for (const f of backupFiles()) {
    let copy = null;
    try {
      copy = new DatabaseSync(path.join(BACKUP_DIR, f), { readOnly: true });
      for (const h of hashesOf(copy)) keep.add(h);
    } catch (err) {
      console.error(`Coffre : sauvegarde ${f} illisible, aucun fichier supprimé (${err.message})`);
      return 0;
    } finally {
      copy?.close();
    }
  }
  return coffre.prune(keep);
}

// Place occupée sur le disque : base (journal WAL compris), fichiers du coffre et sauvegardes.
export function diskUsage() {
  const size = f => { try { return statSync(f).size; } catch { return 0; } };
  const backups = backupFiles();
  return {
    dbBytes: size(DB_PATH) + size(DB_PATH + "-wal"),
    coffreBytes: coffre.bytes(),
    backups: { count: backups.length, kept: BACKUPS_KEPT, bytes: backups.reduce((n, f) => n + size(path.join(BACKUP_DIR, f)), 0) },
  };
}

db.exec(sqlFile("schema.sql"));
if (firstRun) {
  db.exec(sqlFile("defaults.sql"));
  db.exec(sqlFile("seed.sql"));
  db.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
  console.log("Base créée : db/radar.db (entreprises importées depuis db/seed.sql).");
} else {
  const current = db.prepare("PRAGMA user_version").get().user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    backupDb(`avant-migration-${v + 1}`);
    transaction(() => {
      const step = MIGRATIONS[v];
      if (typeof step === "function") step(); else db.exec(step);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
    console.log(`Base migrée vers la version ${v + 1}.`);
  }
  // Rend au disque la place libérée par une migration (fichiers du coffre sortis de la base…)
  if (current < MIGRATIONS.length) db.exec("VACUUM; PRAGMA wal_checkpoint(TRUNCATE);");
}
// Fichiers orphelins (base supprimée par reset-db, envoi interrompu…) : nettoyés au démarrage
pruneCoffre();

// Rejoue le seed : vide entreprises/historique/tags puis les repeuple avec l'import d'origine.
// Les modèles, réglages, documents et notifications sont conservés ; les envois
// programmés vers les entreprises supprimées sont annulés.
export function resetFromSeed() {
  backupDb("avant-reset");
  db.exec(sqlFile("seed.sql"));
  db.prepare(`UPDATE outbox SET status = 'cancelled', error = 'Entreprise supprimée (réinitialisation)'
    WHERE status = 'pending' AND entreprise_id IS NULL`).run();
}

export function closeDb() {
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    db.close();
  } catch { /* déjà fermée */ }
}
