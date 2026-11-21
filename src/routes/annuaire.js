// Annuaire des entreprises (API publique Recherche d'entreprises, sans clé) :
// enrichir une fiche (SIREN, adresse, état actif/fermé) et découvrir des entreprises
// d'un secteur dans un département. Le serveur sert de relais : le navigateur reste
// limité à l'app (CSP connect-src 'self').
import { Router } from "express";
import { db } from "../db.js";

export const annuaireRouter = Router();

const API = "https://recherche-entreprises.api.gouv.fr/search";

export const NAF = {
  "62.01Z": "Programmation informatique",
  "62.02A": "Conseil en systèmes et logiciels informatiques",
  "62.02B": "Tierce maintenance de systèmes informatiques",
  "62.03Z": "Gestion d'installations informatiques",
  "62.09Z": "Autres activités informatiques",
  "58.29A": "Édition de logiciels système et de réseau",
  "58.29C": "Édition de logiciels applicatifs",
  "63.11Z": "Traitement de données, hébergement",
  "63.12Z": "Portails Internet",
  "73.11Z": "Agences de publicité (web)",
  "71.12B": "Ingénierie, études techniques",
};

const EFFECTIFS = {
  "00": "0 salarié", "01": "1-2", "02": "3-5", "03": "6-9", "11": "10-19", "12": "20-49",
  "21": "50-99", "22": "100-199", "31": "200-249", "32": "250-499", "41": "500-999",
  "42": "1 000-1 999", "51": "2 000-4 999", "52": "5 000-9 999", "53": "10 000 +",
};

async function search(params) {
  const url = new URL(API);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { "User-Agent": "radar-alternance (usage personnel)", Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  if (res.status === 429) throw Object.assign(new Error("Annuaire saturé, réessaie dans quelques secondes"), { status: 503 });
  if (!res.ok) throw Object.assign(new Error(`Annuaire indisponible (${res.status})`), { status: 502 });
  return res.json();
}

// Ramène un résultat à l'établissement pertinent : le premier établissement ouvert
// du département demandé, sinon (recherche par nom) le siège.
// En mode strict (découverte), une entreprise sans établissement ouvert dans le département est écartée.
function shape(r, departement, strict = false) {
  const etabs = (r.matching_etablissements || []).filter(e => e.etat_administratif === "A");
  const local = departement && etabs.find(e => String(e.code_postal || "").startsWith(departement));
  if (strict && !local) return null;
  const lieu = local || etabs[0] || r.siege || {};
  const naf = lieu.activite_principale || r.activite_principale || "";
  return {
    siren: r.siren,
    nom: r.nom_complet,
    enseigne: lieu.nom_commercial || (lieu.liste_enseignes || [])[0] || "",
    naf,
    activite: NAF[naf] || naf,
    adresse: lieu.adresse || "",
    cp: lieu.code_postal || "",
    ville: lieu.libelle_commune || "",
    ouverte: r.etat_administratif === "A" && (lieu.etat_administratif ?? "A") === "A",
    effectif: EFFECTIFS[r.tranche_effectif_salarie] || "",
    categorie: r.categorie_entreprise || "",
    creation: r.date_creation || "",
  };
}

export const knownSirens = () => new Set(db.prepare("SELECT siren FROM entreprises WHERE siren != ''").all().map(r => r.siren));
export const knownNames = () => new Set(db.prepare("SELECT lower(trim(nom)) AS n FROM entreprises").all().map(r => r.n));

const wrap = fn => async (req, res) => {
  try {
    res.json(await fn(req.query));
  } catch (err) {
    const timeout = err.name === "TimeoutError";
    res.status(err.status || 502).json({ error: timeout ? "L'annuaire ne répond pas (délai dépassé)" : err.message });
  }
};

// Recherche d'une entreprise précise (enrichissement d'une fiche)
annuaireRouter.get("/recherche", wrap(async ({ q = "", cp = "" }) => {
  const query = String(q).trim();
  if (query.length < 3) throw Object.assign(new Error("Nom trop court pour la recherche"), { status: 400 });
  const code = String(cp).replace(/\D/g, "");
  let results = (await search({ q: query, code_postal: code.length === 5 ? code : "", per_page: 10 })).results || [];
  let elargie = false;
  // Siège ou établissement enregistré ailleurs : on retente sans le code postal
  if (!results.length && code.length === 5) {
    results = (await search({ q: query, per_page: 10 })).results || [];
    elargie = true;
  }
  return { elargie, results: results.map(r => shape(r, code.slice(0, 2))) };
}));

// Découverte : entreprises actives d'un département pour des codes NAF donnés.
annuaireRouter.get("/decouvrir", wrap(async ({ departement = "", naf = "", page = "1" }) => {
  const dep = String(departement).trim().toUpperCase();
  if (!/^(\d{2,3}|2A|2B)$/.test(dep)) throw Object.assign(new Error("Département invalide"), { status: 400 });
  const codes = String(naf).split(",").filter(c => c in NAF);
  if (!codes.length) throw Object.assign(new Error("Choisis au moins un secteur"), { status: 400 });
  const j = await search({
    departement: dep, activite_principale: codes.join(","), etat_administratif: "A",
    per_page: 25, page: Math.max(1, Math.min(400, Number(page) || 1)),
  });
  const sirens = knownSirens();
  const names = knownNames();
  const shaped = (j.results || []).map(r => shape(r, dep, true));
  const kept = shaped.filter(Boolean);
  return {
    total: j.total_results ?? 0,
    pages: j.total_pages ?? 1,
    page: j.page ?? 1,
    masquees: shaped.length - kept.length,
    results: kept.map(s => ({
      ...s,
      dejaSuivie: sirens.has(s.siren) || names.has(s.nom.trim().toLowerCase()) || names.has(s.enseigne.trim().toLowerCase()),
    })),
  };
}));

annuaireRouter.get("/secteurs", (req, res) => res.json(NAF));
