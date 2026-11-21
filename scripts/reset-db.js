// Supprime complètement db/radar.db (entreprises, modèles, réglages, envois ET liste des documents du coffre)
// ainsi que les secrets (mot de passe mail, jeton La bonne alternance) du Gestionnaire d'identifiants Windows.
// La base sera recréée depuis db/*.sql au prochain `npm start`.
// Pour repartir seulement des entreprises d'origine en gardant le reste,
// utilise plutôt le bouton « Réinitialiser » dans les réglages de l'app.
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Entry } from "@napi-rs/keyring";

const dbDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db");
for (const f of ["radar.db", "radar.db-wal", "radar.db-shm"]) {
  rmSync(path.join(dbDir, f), { force: true });
}
for (const account of ["mail", "labonnealternance"]) {
  try { new Entry("radar-alternance", account).deletePassword(); } catch { /* aucun secret enregistré */ }
}
console.log("db/radar.db, le mot de passe mail et le jeton La bonne alternance supprimés — la base sera recréée (schéma + seed) au prochain npm start.");
console.log("Les sauvegardes de db/backups sont conservées, avec les fichiers de db/coffre qu'elles citent ; les autres fichiers du coffre seront supprimés au prochain démarrage.");
