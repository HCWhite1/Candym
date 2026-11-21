// Secrets (mot de passe de la boîte mail, jeton La bonne alternance) : stockés dans le
// Gestionnaire d'identifiants Windows (Credential Manager, via @napi-rs/keyring),
// jamais dans db/radar.db ni dans ses sauvegardes.
import { Entry } from "@napi-rs/keyring";
import { db, getSetting, deleteSetting } from "./db.js";

// RADAR_KEYRING_SERVICE : coffre alternatif (tests automatisés uniquement)
const SERVICE = process.env.RADAR_KEYRING_SERVICE || "radar-alternance";
const entry = new Entry(SERVICE, "mail");

const lbaEntry = new Entry(SERVICE, "labonnealternance");

export function getLbaToken() {
  try {
    return lbaEntry.getPassword() || "";
  } catch {
    return "";
  }
}

export function setLbaToken(token) {
  lbaEntry.setPassword(String(token));
}

export function deleteLbaToken() {
  try { lbaEntry.deletePassword(); } catch { /* rien à supprimer */ }
}

export function getMailPassword() {
  try {
    return entry.getPassword() || "";
  } catch {
    return "";
  }
}

export function setMailPassword(pass) {
  entry.setPassword(String(pass));
}

export function deleteMailPassword() {
  try { entry.deletePassword(); } catch { /* rien à supprimer */ }
}

// Anciennes versions : le mot de passe était en clair dans la table settings.
// Au démarrage, on le déplace dans le coffre Windows puis on l'efface de la base.
export function migrateLegacyPassword() {
  const legacy = getSetting("mail_pass");
  if (legacy === null) return false;
  if (legacy && !getMailPassword()) setMailPassword(legacy);
  // secure_delete écrase les octets libérés ; le checkpoint purge l'ancienne page du WAL.
  db.exec("PRAGMA secure_delete = ON;");
  deleteSetting("mail_pass");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  return true;
}
