import { Router } from "express";
import { db, patchRow, transaction } from "../db.js";
import { normalizeUrl } from "../security.js";
import { FREEMAIL, domainOf } from "../mail/classify.js";

export const entreprisesRouter = Router();

const bool01 = v => (v ? 1 : 0);
const entretien = v => {
  const s = String(v ?? "").trim();
  if (s && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) {
    throw Object.assign(new Error("Date d'entretien invalide (AAAA-MM-JJTHH:MM)"), { status: 400 });
  }
  return s;
};

// Champs modifiables par l'API : clé camelCase → colonne (+ conversion)
const FIELDS = {
  nom: { col: "nom", map: v => String(v ?? "").trim() },
  activite: { col: "activite" },
  ville: { col: "ville" },
  cp: { col: "cp" },
  adresse: { col: "adresse" },
  email: { col: "email", map: v => String(v ?? "").trim() },
  tel: { col: "tel" },
  url: { col: "url", map: normalizeUrl },
  pertinence: { col: "pertinence" },
  pertinenceNote: { col: "pertinence_note" },
  statut: { col: "statut" },
  note: { col: "note" },
  reponse: { col: "reponse", map: bool01 },
  contactNom: { col: "contact_nom" },
  contactPoste: { col: "contact_poste" },
  dateEntretien: { col: "date_entretien", map: entretien },
  siren: { col: "siren", map: v => String(v ?? "").replace(/\D/g, "").slice(0, 9) },
};
const DEFAULTS = { statut: "a_contacter", reponse: 0 };

// Le marqueur « réponse reçue » suit le statut quand l'appelant ne le précise pas :
// piste/acceptée/refusée → une réponse a été reçue ; tout statut d'avant-réponse → on attend de nouveau
// (sinon une entreprise refusée puis recontactée ne serait plus jamais signalée « à relancer »).
// « Fermée » ne dit rien de la réponse : le marqueur reste tel quel.
const REPONSE_PAR_STATUT = {
  piste: true, acceptee: true, refusee: true,
  a_evaluer: false, a_contacter: false, contacte: false, relancee: false,
};
const withReponse = b => (b.statut !== undefined && b.reponse === undefined && Object.hasOwn(REPONSE_PAR_STATUT, b.statut)
  ? { ...b, reponse: REPONSE_PAR_STATUT[b.statut] }
  : b);

// Une seule requête : historique et tags agrégés en JSON par SQLite.
const SELECT = `SELECT e.id, e.nom, e.activite, e.ville, e.cp, e.adresse, e.email, e.tel, e.url,
  e.pertinence, e.pertinence_note AS pertinenceNote, e.statut, e.note, e.reponse,
  e.contact_nom AS contactNom, e.contact_poste AS contactPoste, e.date_entretien AS dateEntretien, e.siren,
  (SELECT json_group_array(json_object('date', h.date, 'type', h.type, 'moyen', h.moyen, 'note', h.note, 'templateId', h.template_id))
     FROM (SELECT * FROM historique WHERE entreprise_id = e.id ORDER BY date) h) AS historique,
  (SELECT json_group_array(label) FROM tags WHERE entreprise_id = e.id) AS tags
  FROM entreprises e`;

const shape = r => ({ ...r, reponse: !!r.reponse, historique: JSON.parse(r.historique), tags: JSON.parse(r.tags) });

export function getEntreprise(id) {
  const row = db.prepare(SELECT + " WHERE e.id = ?").get(id);
  return row ? shape(row) : null;
}

function setTags(id, tags) {
  db.prepare("DELETE FROM tags WHERE entreprise_id = ?").run(id);
  const ins = db.prepare("INSERT INTO tags (entreprise_id, label) VALUES (?, ?)");
  for (const t of tags) ins.run(id, String(t));
}

// Création (utilisée aussi par l'import JSON). Renvoie l'id.
export function insertEntreprise(data) {
  const b = withReponse(data);
  const cols = [];
  const vals = [];
  for (const [key, { col, map = String }] of Object.entries(FIELDS)) {
    cols.push(col);
    vals.push(map(b[key] ?? DEFAULTS[key] ?? ""));
  }
  return transaction(() => {
    const info = db.prepare(`INSERT INTO entreprises (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...vals);
    const id = Number(info.lastInsertRowid);
    if (Array.isArray(b.tags)) setTags(id, b.tags);
    return id;
  });
}

// Règle unique « un mail vient de partir » (brouillon confirmé comme envoi SMTP) :
// relance si l'entreprise a déjà été contactée, sinon premier contact ;
// une piste ou une acceptation en cours n'est pas rétrogradée. Renvoie false si l'entreprise n'existe pas.
export function recordMailSent(id, { moyen = "Mail", note = "", templateId = null } = {}) {
  const e = db.prepare("SELECT statut FROM entreprises WHERE id = ?").get(id);
  if (!e) return false;
  const relance = !!db.prepare("SELECT 1 FROM historique WHERE entreprise_id = ? AND type = 'contact' LIMIT 1").get(id);
  const statut = ["piste", "acceptee"].includes(e.statut) ? e.statut : relance ? "relancee" : "contacte";
  transaction(() => {
    db.prepare("INSERT INTO historique (entreprise_id, date, type, moyen, note, template_id) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, new Date().toISOString(), relance ? "relance" : "contact", moyen, note, templateId);
    db.prepare("UPDATE entreprises SET statut = ?, reponse = 0 WHERE id = ?").run(statut, id);
  });
  return true;
}

entreprisesRouter.get("/", (req, res) => {
  res.json(db.prepare(SELECT).all().map(shape));
});

// Doublons potentiels avant création : même nom (insensible à la casse),
// même SIREN, ou même domaine d'email professionnel.
entreprisesRouter.get("/doublons", (req, res) => {
  const nom = String(req.query.nom || "").trim().toLowerCase();
  const siren = String(req.query.siren || "").replace(/\D/g, "");
  const domain = domainOf(req.query.email);
  const byDomain = domain && !FREEMAIL.has(domain);
  const rows = db.prepare("SELECT id, nom, email, siren FROM entreprises").all().filter(e =>
    (nom && e.nom.trim().toLowerCase() === nom)
    || (siren && e.siren === siren)
    || (byDomain && domainOf(e.email) === domain));
  res.json(rows);
});

entreprisesRouter.post("/", (req, res) => {
  const b = req.body ?? {};
  if (!String(b.nom ?? "").trim()) return res.status(400).json({ error: "Le nom est obligatoire" });
  res.status(201).json(getEntreprise(insertEntreprise(b)));
});

// Mise à jour partielle : seuls les champs présents dans le corps sont modifiés
entreprisesRouter.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const b = withReponse(req.body ?? {});
  if ("nom" in b && !String(b.nom ?? "").trim()) return res.status(400).json({ error: "Le nom est obligatoire" });
  transaction(() => {
    patchRow("entreprises", FIELDS, b, id);
    if (Array.isArray(b.tags)) setTags(id, b.tags);
  });
  const e = getEntreprise(id);
  if (!e) return res.status(404).json({ error: "Entreprise introuvable" });
  res.json(e);
});

entreprisesRouter.delete("/:id", (req, res) => {
  const info = db.prepare("DELETE FROM entreprises WHERE id = ?").run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: "Entreprise introuvable" });
  res.status(204).end();
});

// Journalise un échange et, si demandé, met à jour statut/réponse dans la foulée.
// Renvoie l'entreprise complète mise à jour.
entreprisesRouter.post("/:id/historique", (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare("SELECT 1 FROM entreprises WHERE id = ?").get(id)) {
    return res.status(404).json({ error: "Entreprise introuvable" });
  }
  const { type, moyen = "", note = "", date, statut, reponse, templateId } = withReponse(req.body ?? {});
  if (!["contact", "relance", "reponse", "note"].includes(type)) {
    return res.status(400).json({ error: "Type d'événement invalide" });
  }
  const when = date ? new Date(date) : new Date();
  if (Number.isNaN(when.getTime())) return res.status(400).json({ error: "Date invalide" });
  transaction(() => {
    db.prepare("INSERT INTO historique (entreprise_id, date, type, moyen, note, template_id) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, when.toISOString(), type, String(moyen), String(note), templateId ? Number(templateId) : null);
    patchRow("entreprises", { statut: FIELDS.statut, reponse: FIELDS.reponse }, { statut, reponse }, id);
  });
  res.json(getEntreprise(id));
});

// Mail envoyé depuis un brouillon (Gmail, Outlook, mailto) et confirmé par l'utilisateur :
// le serveur trace l'échange et décide du statut. Renvoie l'entreprise à jour.
entreprisesRouter.post("/:id/envoi", (req, res) => {
  const id = Number(req.params.id);
  const { templateId } = req.body ?? {};
  if (!recordMailSent(id, { templateId: templateId ? Number(templateId) : null })) {
    return res.status(404).json({ error: "Entreprise introuvable" });
  }
  res.json(getEntreprise(id));
});
