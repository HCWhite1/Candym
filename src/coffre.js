// Fichiers du coffre, rangés hors de la base (db/coffre/) sous leur empreinte SHA-256.
// Un même contenu n'est stocké qu'une fois, quel que soit le nombre de documents ou de
// sauvegardes qui le citent : les sauvegardes de la base ne contiennent que l'empreinte.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const HASH = /^[0-9a-f]{64}$/;

export function createStore(dir) {
  // L'empreinte vient toujours du serveur ; le contrôle garantit qu'elle ne sort pas du dossier.
  const file = hash => {
    if (!HASH.test(hash)) throw new Error("Empreinte de document invalide");
    return path.join(dir, hash);
  };
  const entries = () => (existsSync(dir) ? readdirSync(dir) : []);

  return {
    path: file,
    has: hash => existsSync(file(hash)),
    read: hash => readFileSync(file(hash)),

    // Range un contenu et renvoie son empreinte ; un contenu déjà présent n'est pas réécrit.
    put(buffer) {
      const hash = createHash("sha256").update(buffer).digest("hex");
      const target = file(hash);
      if (!existsSync(target)) {
        mkdirSync(dir, { recursive: true });
        const tmp = `${target}.${process.pid}.tmp`;
        writeFileSync(tmp, buffer);
        renameSync(tmp, target); // jamais de fichier à moitié écrit sous son nom définitif
      }
      return hash;
    },

    bytes: () => entries().filter(f => HASH.test(f)).reduce((n, f) => n + statSync(path.join(dir, f)).size, 0),

    // Supprime les fichiers absents de `keep` (et les restes d'écriture interrompue). Renvoie le nombre supprimé.
    prune(keep) {
      let removed = 0;
      for (const f of entries()) {
        if (HASH.test(f) ? keep.has(f) : !f.endsWith(".tmp")) continue;
        rmSync(path.join(dir, f), { force: true });
        removed++;
      }
      return removed;
    },
  };
}
