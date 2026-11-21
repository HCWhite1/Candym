// Migration d'une ancienne base : le mot de passe en clair quitte la base ET ses sauvegardes.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "radar-backup-"));
const dbPath = path.join(dir, "old.db");
const SECRET = "abcd efgh ijkl mnop";

// Base « version 0 » : ancien schéma, mot de passe en clair dans settings
const old = new DatabaseSync(dbPath);
old.exec(`
  CREATE TABLE entreprises (id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT NOT NULL, activite TEXT NOT NULL DEFAULT '',
    ville TEXT NOT NULL DEFAULT '', cp TEXT NOT NULL DEFAULT '', adresse TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    tel TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', pertinence TEXT NOT NULL DEFAULT '', pertinence_note TEXT NOT NULL DEFAULT '',
    statut TEXT NOT NULL DEFAULT 'a_contacter', note TEXT NOT NULL DEFAULT '', reponse INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE historique (id INTEGER PRIMARY KEY AUTOINCREMENT, entreprise_id INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
    date TEXT NOT NULL, type TEXT NOT NULL, moyen TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '');
  CREATE TABLE templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '');
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT INTO settings VALUES ('mail_pass', '${SECRET}'), ('mail_user', 'moi@example.com');
  INSERT INTO templates (name, subject, body) VALUES ('Relance', 'Relance', 'Cordialement,\n[Prénom NOM]\n[Téléphone]');
  INSERT INTO entreprises (nom, url) VALUES ('Sans schéma', 'exemple.fr');
`);
old.close();

process.env.RADAR_DB_PATH = dbPath;
process.env.RADAR_KEYRING_SERVICE = `radar-alternance-test-backup-${process.pid}`;
const { db, closeDb } = await import("../src/db.js");
const secrets = await import("../src/secrets.js");

after(() => {
  secrets.deleteMailPassword();
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test("les migrations s'appliquent à une ancienne base", () => {
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 3);
  // Table créée par schema.sql (base antérieure aux notifications) : la migration 2 ne la casse pas
  assert.ok(db.prepare("PRAGMA table_info(notifications)").all().some(c => c.name === "motifs"));
  const t = db.prepare("SELECT kind, body FROM templates").get();
  assert.equal(t.kind, "relance");
  assert.equal(t.body, "Cordialement,\n{moi.nom}\n{moi.tel}");
  assert.equal(db.prepare("SELECT url FROM entreprises").get().url, "https://exemple.fr");
});

test("les sauvegardes d'avant migration ne contiennent pas le mot de passe", () => {
  const backups = readdirSync(path.join(dir, "backups")).sort();
  assert.equal(backups.length, 3);
  assert.match(backups[0], /avant-migration-1/);
  assert.match(backups[1], /avant-migration-2/);
  assert.match(backups[2], /avant-migration-3/);
  for (const b of backups) {
    const bytes = readFileSync(path.join(dir, "backups", b));
    assert.equal(bytes.includes(Buffer.from(SECRET)), false, b);
    // …mais le reste des données est bien là
    const copy = new DatabaseSync(path.join(dir, "backups", b), { readOnly: true });
    assert.equal(copy.prepare("SELECT value FROM settings WHERE key = 'mail_user'").get().value, "moi@example.com");
    copy.close();
  }
});

test("le mot de passe passe dans le coffre Windows et disparaît de la base", () => {
  assert.equal(secrets.migrateLegacyPassword(), true);
  assert.equal(secrets.getMailPassword(), SECRET);
  assert.equal(db.prepare("SELECT 1 FROM settings WHERE key = 'mail_pass'").get(), undefined);
  closeDb();
  assert.equal(readFileSync(dbPath).includes(Buffer.from(SECRET)), false);
});
