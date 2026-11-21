// Statistiques de la recherche : entonnoir, taux et délai de réponse,
// efficacité par modèle de message, activité par semaine.
import { Router } from "express";
import { db } from "../db.js";

export const statsRouter = Router();

const DAY = 86400000;
const OUTREACH = new Set(["contact", "relance"]);
const POSITIVE = new Set(["piste", "acceptee"]);

// Lundi de la semaine (heure locale) au format AAAA-MM-JJ
function weekStart(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x.toLocaleDateString("sv-SE");
}

const median = arr => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

statsRouter.get("/", (req, res) => {
  const entreprises = db.prepare("SELECT id, statut FROM entreprises").all();
  const hist = db.prepare("SELECT entreprise_id AS eid, date, type, moyen, template_id AS tpl FROM historique ORDER BY date").all();
  const templates = db.prepare("SELECT id, name, kind FROM templates").all();

  const byEnt = new Map(entreprises.map(e => [e.id, { ...e, events: [] }]));
  for (const h of hist) byEnt.get(h.eid)?.events.push(h);

  const parStatut = {};
  for (const e of entreprises) parStatut[e.statut] = (parStatut[e.statut] || 0) + 1;

  // Taux et délai : première réponse postérieure au premier contact
  let contactees = 0, repondues = 0;
  const delais = [];
  for (const e of byEnt.values()) {
    const first = e.events.find(h => OUTREACH.has(h.type));
    if (!first) continue;
    contactees++;
    const rep = e.events.find(h => h.type === "reponse" && h.date >= first.date);
    if (rep || ["piste", "acceptee", "refusee"].includes(e.statut)) repondues++;
    if (rep) delais.push((new Date(rep.date) - new Date(first.date)) / DAY);
  }

  // Par modèle : envois tracés avec un modèle, et réponses qui ont suivi ces envois
  const tplStats = new Map(templates.map(t => [t.id, { id: t.id, name: t.name, kind: t.kind, envois: 0, reponses: 0, positives: 0 }]));
  for (const e of byEnt.values()) {
    const seen = new Set();
    for (const [i, h] of e.events.entries()) {
      if (!OUTREACH.has(h.type) || !tplStats.has(h.tpl)) continue;
      const t = tplStats.get(h.tpl);
      t.envois++;
      // La réponse est attribuée au dernier envoi qui la précède
      const next = e.events.slice(i + 1);
      const rep = next.find(x => x.type === "reponse");
      const nextSend = next.find(x => OUTREACH.has(x.type));
      if (rep && (!nextSend || rep.date <= nextSend.date) && !seen.has(h.tpl)) {
        seen.add(h.tpl);
        t.reponses++;
        if (POSITIVE.has(e.statut)) t.positives++;
      }
    }
  }

  // Activité sur 12 semaines (envois et réponses)
  const semaines = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) semaines.push({ semaine: weekStart(new Date(now - i * 7 * DAY)), envois: 0, reponses: 0 });
  const idx = new Map(semaines.map((s, i) => [s.semaine, i]));
  for (const h of hist) {
    const i = idx.get(weekStart(h.date));
    if (i === undefined) continue;
    if (OUTREACH.has(h.type)) semaines[i].envois++;
    else if (h.type === "reponse") semaines[i].reponses++;
  }

  // Canaux de premier contact
  const canaux = {};
  for (const h of hist) {
    if (h.type !== "contact") continue;
    const m = /^mail/i.test(h.moyen) ? "Mail" : /^t[ée]l/i.test(h.moyen) ? "Téléphone" : /formulaire|site/i.test(h.moyen) ? "Formulaire / site"
      : /manuel/i.test(h.moyen) ? "Non précisé" : h.moyen || "Non précisé";
    canaux[m] = (canaux[m] || 0) + 1;
  }

  res.json({
    total: entreprises.length,
    parStatut,
    contactees,
    repondues,
    tauxReponse: contactees ? repondues / contactees : null,
    delaiMedianJours: median(delais),
    delaiMoyenJours: delais.length ? delais.reduce((a, b) => a + b, 0) / delais.length : null,
    parModele: [...tplStats.values()].filter(t => t.envois),
    semaines,
    canaux,
  });
});
