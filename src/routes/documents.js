import { Router, raw } from "express";
import { db, coffre, pruneCoffre, diskUsage } from "../db.js";

export const documentsRouter = Router();

const META = "SELECT id, name, type, size, added_at AS addedAt FROM documents";

// Plafond du volume cumulé du coffre. Les fichiers vivent dans db/coffre/ et ne sont jamais
// recopiés dans les sauvegardes : ce plafond borne donc toute la place prise par le coffre.
const VAULT_MAX_BYTES = 2048 * 1048576;
const vaultBytes = () => db.prepare("SELECT COALESCE(SUM(size), 0) AS b FROM documents").get().b;
const taille = n => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} Go` : `${(n / 1048576).toFixed(1)} Mo`).replace(".", ",");

documentsRouter.get("/", (req, res) => {
  res.json(db.prepare(META + " ORDER BY added_at").all());
});

// Place occupée : coffre, base, fichiers du coffre sur le disque et sauvegardes.
documentsRouter.get("/usage", (req, res) => {
  res.json({ vaultBytes: vaultBytes(), vaultMaxBytes: VAULT_MAX_BYTES, ...diskUsage() });
});

// Nom affiché et utilisé comme nom de pièce jointe : sans caractères de contrôle ni chemin.
const cleanName = s => String(s).replace(/[\x00-\x1f\x7f]/g, "").replace(/^.*[\\/]/, "").trim().slice(0, 150) || "document";
const cleanType = s => (/^[\w.+-]+\/[\w.+-]+$/.test(s) ? s : "application/octet-stream");

// Le fichier est envoyé en corps brut ; son nom (encodé URI) passe par l'en-tête X-Filename.
documentsRouter.post("/", raw({ type: () => true, limit: "25mb" }), (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    return res.status(400).json({ error: "Fichier vide ou manquant" });
  }
  let name;
  try { name = cleanName(decodeURIComponent(req.get("x-filename") || "document")); }
  catch { return res.status(400).json({ error: "Nom de fichier invalide" }); }
  const type = cleanType(String(req.get("content-type") || "").split(";")[0].trim());
  const used = vaultBytes();
  if (used + req.body.length > VAULT_MAX_BYTES) {
    return res.status(413).json({
      error: `Coffre plein : ${taille(used)} utilisés sur ${taille(VAULT_MAX_BYTES)}. Supprime d'abord les documents qui ne servent plus.`,
    });
  }
  const hash = coffre.put(req.body);
  const info = db.prepare("INSERT INTO documents (name, type, size, hash) VALUES (?, ?, ?, ?)")
    .run(name, type, req.body.length, hash);
  res.status(201).json(db.prepare(META + " WHERE id = ?").get(Number(info.lastInsertRowid)));
});

documentsRouter.get("/:id/download", (req, res) => {
  const doc = db.prepare("SELECT name, type, hash FROM documents WHERE id = ?").get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: "Document introuvable" });
  if (!coffre.has(doc.hash)) return res.status(404).json({ error: `Le fichier de « ${doc.name} » manque dans db/coffre` });
  res.set("Content-Type", cleanType(doc.type));
  res.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(doc.name)}`);
  res.sendFile(coffre.path(doc.hash));
});

// Aperçu dans l'app : PDF et images matricielles seulement (pas de SVG ni de HTML, qui
// pourraient exécuter du script). Le type est déduit du type enregistré, sinon de l'extension.
const PREVIEW_TYPES = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
};
export function previewType({ type, name }) {
  if (Object.values(PREVIEW_TYPES).includes(type)) return type;
  return PREVIEW_TYPES[String(name).split(".").pop().toLowerCase()] || "";
}

// Servi « inline » et encadrable par l'app elle-même (iframe de la modale du coffre) :
// la CSP du fichier interdit tout script et tout chargement externe.
documentsRouter.get("/:id/preview", (req, res) => {
  const doc = db.prepare("SELECT name, type, hash FROM documents WHERE id = ?").get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: "Document introuvable" });
  const type = previewType(doc);
  if (!type) return res.status(415).json({ error: "Aperçu disponible pour les PDF et les images seulement" });
  if (!coffre.has(doc.hash)) return res.status(404).json({ error: `Le fichier de « ${doc.name} » manque dans db/coffre` });
  res.set({
    "Content-Type": type,
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'",
    "X-Frame-Options": "SAMEORIGIN",
    "Cache-Control": "no-store",
  });
  res.sendFile(coffre.path(doc.hash));
});

documentsRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const pending = db.prepare("SELECT COUNT(*) AS c FROM outbox WHERE status = 'pending' AND EXISTS (SELECT 1 FROM json_each(attachments) WHERE value = ?)").get(id).c;
  if (pending && req.query.force !== "1") {
    return res.status(409).json({ error: `Ce document est joint à ${pending} envoi(s) programmé(s)`, pending });
  }
  const info = db.prepare("DELETE FROM documents WHERE id = ?").run(id);
  if (!info.changes) return res.status(404).json({ error: "Document introuvable" });
  pruneCoffre(); // le fichier reste sur le disque tant qu'un autre document ou une sauvegarde le cite
  res.status(204).end();
});
