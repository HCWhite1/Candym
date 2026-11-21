// Migration 3 : les fichiers du coffre sortent de la base vers coffre/, un fichier par contenu ;
// un fichier n'est supprimé que si ni la base ni aucune sauvegarde ne le cite.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "radar-coffre-"));
const dbPath = path.join(dir, "radar.db");
const coffreDir = path.join(dir, "coffre");
const backupsDir = path.join(dir, "backups");
const CV = Buffer.from("%PDF-1.4 cv"), LETTRE = Buffer.from("%PDF-1.4 lettre");
const sha = b => createHash("sha256").update(b).digest("hex");

// Base « version 2 » : documents stockés dans la base (BLOB), dont deux fois le même CV
const old = new DatabaseSync(dbPath);
old.exec(`CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL, added_at TEXT NOT NULL DEFAULT (datetime('now')), content BLOB NOT NULL);
  PRAGMA user_version = 2;`);
const ins = old.prepare("INSERT INTO documents (name, size, content) VALUES (?, ?, ?)");
for (const [name, b] of [["CV.pdf", CV], ["CV copie.pdf", CV], ["Lettre.pdf", LETTRE]]) ins.run(name, b.length, b);
old.close();

process.env.RADAR_DB_PATH = dbPath;
const { db, closeDb, backupDb, pruneCoffre } = await import("../src/db.js");

after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const files = () => readdirSync(coffreDir).sort();

test("migration 3 : fichiers sortis de la base, un seul par contenu", () => {
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 3);
  const cols = db.prepare("PRAGMA table_info(documents)").all().map(c => c.name);
  assert.ok(cols.includes("hash") && !cols.includes("content"));
  assert.deepEqual(files(), [sha(CV), sha(LETTRE)].sort());
  const docs = db.prepare("SELECT name, size, hash FROM documents ORDER BY id").all();
  assert.deepEqual(docs.map(d => d.hash), [sha(CV), sha(CV), sha(LETTRE)]);
  assert.deepEqual(readFileSync(path.join(coffreDir, sha(LETTRE))), LETTRE);
  assert.equal(docs[2].size, LETTRE.length);
});

test("la sauvegarde d'avant migration garde l'ancien format, fichiers compris", () => {
  const [b] = readdirSync(backupsDir).filter(f => f.includes("avant-migration-3"));
  const copy = new DatabaseSync(path.join(backupsDir, b), { readOnly: true });
  assert.equal(copy.prepare("SELECT COUNT(*) AS c FROM documents WHERE content IS NOT NULL").get().c, 3);
  copy.close();
});

test("un fichier cité par une sauvegarde est gardé ; dans le doute, rien n'est supprimé", () => {
  const backup = backupDb("test");            // nouveau format : cite les empreintes
  db.exec("DELETE FROM documents");
  assert.equal(pruneCoffre(), 0);
  assert.equal(files().length, 2, "cités par la sauvegarde");

  rmSync(backup);
  const garbage = path.join(backupsDir, "radar-9999-illisible.db");
  writeFileSync(garbage, "pas une base");
  assert.equal(pruneCoffre(), 0);
  assert.equal(files().length, 2, "sauvegarde illisible : on ne supprime rien");

  rmSync(garbage);
  assert.equal(pruneCoffre(), 2);            // l'ancienne sauvegarde contient ses fichiers elle-même
  assert.deepEqual(files(), []);
});
