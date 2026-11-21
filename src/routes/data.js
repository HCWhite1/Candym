// Import d'une sauvegarde JSON et réinitialisation depuis le seed.
import { Router } from "express";
import { readFileSync } from "node:fs";
import { db, resetFromSeed, backupDb, transaction, setSetting } from "../db.js";
import { insertEntreprise } from "./entreprises.js";
import { emit } from "../events.js";

export const dataRouter = Router();

const KINDS = ["candidature", "relance", "autre"];

// Remplace toutes les données par celles d'un export JSON de l'app
// (compatible avec les exports des anciennes versions).
dataRouter.post("/import", (req, res) => {
  const { entreprises, templates, settings } = req.body ?? {};
  if (!Array.isArray(entreprises)) {
    return res.status(400).json({ error: "Format invalide — attendu : un export JSON de cette app" });
  }
  backupDb("avant-import");
  let count = 0;
  transaction(() => {
    db.exec("DELETE FROM historique; DELETE FROM tags; DELETE FROM entreprises;");
    // Modèles d'abord, en gardant leurs ids : l'historique y fait référence (statistiques par modèle).
    if (Array.isArray(templates) && templates.length) {
      db.exec("DELETE FROM templates;");
      const insTpl = db.prepare("INSERT INTO templates (id, name, subject, body, kind) VALUES (?, ?, ?, ?, ?)");
      for (const t of templates) {
        insTpl.run(Number.isInteger(t.id) ? t.id : null, String(t.name ?? "Sans nom"), String(t.subject ?? ""),
          String(t.body ?? ""), KINDS.includes(t.kind) ? t.kind : "autre");
      }
    }
    const tplIds = new Set(db.prepare("SELECT id FROM templates").all().map(t => t.id));
    const insHist = db.prepare("INSERT INTO historique (entreprise_id, date, type, moyen, note, template_id) VALUES (?, ?, ?, ?, ?, ?)");
    for (const e of entreprises) {
      if (!String(e?.nom ?? "").trim()) continue;
      const id = insertEntreprise({ ...e, url: safeImportUrl(e.url) });
      count++;
      for (const h of Array.isArray(e.historique) ? e.historique : []) {
        insHist.run(id, String(h.date ?? new Date().toISOString()), String(h.type ?? "note"), String(h.moyen ?? ""),
          String(h.note ?? ""), tplIds.has(h.templateId) ? h.templateId : null);
      }
    }
    const delai = Number(settings?.delaiRelance);
    if (Number.isInteger(delai) && delai >= 1 && delai <= 60) setSetting("delai_relance", delai);
  });
  emit("entreprises"); // les autres onglets ouverts se rechargent
  res.json({ ok: true, count });
});

// Une URL invalide dans un vieil export ne doit pas faire échouer tout l'import.
const safeImportUrl = url => {
  const u = String(url ?? "").trim();
  return !u || /^https?:\/\//i.test(u) || !u.includes(":") ? u : "";
};

// Ce que ferait une réinitialisation, pour une confirmation explicite côté front.
const SEED_SQL = readFileSync(new URL("../../db/seed.sql", import.meta.url), "utf8");
const SEED_START = SEED_SQL.indexOf("INSERT INTO entreprises");
const SEED_END = SEED_SQL.indexOf("INSERT INTO historique");
const SEED_COUNT = SEED_START === -1 ? 0
  : (SEED_SQL.slice(SEED_START, SEED_END === -1 ? undefined : SEED_END).match(/^\s*\(\d+, '/gm) || []).length;

dataRouter.get("/reset", (req, res) => {
  res.json({
    seedEntreprises: SEED_COUNT,
    entreprises: db.prepare("SELECT COUNT(*) AS c FROM entreprises").get().c,
    historique: db.prepare("SELECT COUNT(*) AS c FROM historique").get().c,
    envoisProgrammes: db.prepare("SELECT COUNT(*) AS c FROM outbox WHERE status = 'pending'").get().c,
  });
});

// Repart des entreprises du fichier d'origine (modèles, réglages, coffre et notifications conservés).
dataRouter.post("/reset", (req, res) => {
  resetFromSeed();
  emit("entreprises");
  res.json({ ok: true });
});
