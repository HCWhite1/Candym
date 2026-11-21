import { Router } from "express";
import { getSetting, setSetting } from "../db.js";
import { showToast } from "../notify.js";

export const settingsRouter = Router();

// Modes d'envoi : brouillon pré-rempli (Gmail / Outlook.com dans le navigateur,
// ou mailto: pour un client installé) ou envoi direct par SMTP depuis l'app.
const SEND_MODES = ["gmail", "outlook", "mailto", "smtp"];

function parsePortals(raw) {
  try {
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function currentSettings() {
  return {
    delaiRelance: Number(getSetting("delai_relance", 7)),
    mailOpenMode: getSetting("mail_open_mode", "gmail"),
    meNom: getSetting("me_nom", ""),
    meTel: getSetting("me_tel", ""),
    notifWindows: getSetting("notif_windows", "1") === "1",
    customPortals: parsePortals(getSetting("custom_portals", "[]")),
  };
}

const bad = (res, error) => res.status(400).json({ error });

settingsRouter.get("/", (req, res) => res.json(currentSettings()));

settingsRouter.put("/", (req, res) => {
  const b = req.body ?? {};
  if (b.delaiRelance !== undefined) {
    const v = Number(b.delaiRelance);
    if (!Number.isInteger(v) || v < 1 || v > 60) return bad(res, "delaiRelance doit être un entier entre 1 et 60");
    setSetting("delai_relance", v);
  }
  if (b.mailOpenMode !== undefined) {
    if (!SEND_MODES.includes(b.mailOpenMode)) return bad(res, "Mode d'envoi invalide (gmail, outlook, mailto ou smtp)");
    setSetting("mail_open_mode", b.mailOpenMode);
  }
  for (const [key, col] of [["meNom", "me_nom"], ["meTel", "me_tel"]]) {
    if (b[key] === undefined) continue;
    const v = String(b[key]).trim();
    if (v.length > 80) return bad(res, "Valeur trop longue (80 caractères maximum)");
    setSetting(col, v);
  }
  if (b.notifWindows !== undefined) setSetting("notif_windows", b.notifWindows ? "1" : "0");
  if (b.customPortals !== undefined) {
    if (!Array.isArray(b.customPortals) || b.customPortals.length > 20) {
      return bad(res, "customPortals doit contenir au plus 20 sources");
    }
    const clean = [];
    for (const p of b.customPortals) {
      const name = String(p?.name ?? "").trim().slice(0, 40);
      const url = String(p?.url ?? "").trim();
      if (!name || !/^https?:\/\//i.test(url) || url.length > 500) {
        return bad(res, "Chaque source doit avoir un nom et une URL http(s) valide");
      }
      clean.push({ id: String(p?.id || name.toLowerCase().replace(/[^a-z0-9]+/g, "-")).slice(0, 40), name, url });
    }
    setSetting("custom_portals", JSON.stringify(clean));
  }
  res.json(currentSettings());
});

settingsRouter.post("/test-notification", (req, res) => {
  showToast("Candym", "Les notifications Windows fonctionnent.", { force: true });
  res.json({ ok: true });
});
