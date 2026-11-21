// La bonne alternance (API apprentissage.beta.gouv.fr, jeton personnel) : offres
// d'alternance, et entreprises susceptibles de recruter des alternants sans offre
// publiée (candidatures spontanées). Le jeton reste dans le coffre Windows ; le
// serveur sert de relais, le navigateur restant limité à l'app (CSP connect-src 'self').
import { Router } from "express";
import { getLbaToken, setLbaToken, deleteLbaToken } from "../secrets.js";
import { normalizeUrl } from "../security.js";
import { knownSirens, knownNames } from "./annuaire.js";

export const lbaRouter = Router();

// RADAR_LBA_URL : faux serveur local (tests automatisés uniquement)
const API = process.env.RADAR_LBA_URL || "https://api.apprentissage.beta.gouv.fr/api";

// Codes ROME (référentiel des métiers de France Travail) utiles à un BTS SIO
export const METIERS = {
  M1805: "Études et développement informatique",
  M1810: "Production et exploitation de systèmes d'information",
  M1801: "Administration de systèmes d'information",
  M1802: "Expertise et support en systèmes d'information",
  M1806: "Conseil et maîtrise d'ouvrage en systèmes d'information",
  E1205: "Réalisation de contenus multimédias (web)",
};

export const NIVEAUX = { 5: "Bac+2 (BTS, DUT)", 6: "Bac+3 (licence, BUT)", 7: "Bac+5 (master, ingénieur)" };

const fail = (status, message) => Object.assign(new Error(message), { status });

async function call(pathname, params, token = getLbaToken()) {
  if (!token) throw fail(400, "Aucun jeton La bonne alternance : ajoute-le dans Réglages.");
  const url = new URL(API + pathname);
  for (const [k, v] of Object.entries(params)) {
    for (const item of [v].flat()) if (item !== undefined && item !== "") url.searchParams.append(k, item);
  }
  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw fail(502, err.name === "TimeoutError" ? "La bonne alternance ne répond pas (délai dépassé)" : "La bonne alternance est injoignable");
  }
  if (res.status === 401) throw fail(400, "Jeton refusé par La bonne alternance : il est peut-être révoqué, ou mal copié.");
  if (res.status === 403) throw fail(400, "Ce jeton n'a pas accès à la recherche d'offres.");
  if (res.status === 429) throw fail(503, "Trop de recherches d'affilée (60 par minute) : réessaie dans un instant.");
  if (res.status === 400) throw fail(400, "Recherche refusée par La bonne alternance (paramètres invalides).");
  if (!res.ok) throw fail(502, `La bonne alternance est indisponible (${res.status})`);
  return res.json();
}

const safeUrl = value => {
  try { return normalizeUrl(value); } catch { return ""; }
};

// « 12 RUE DE LA PAIX 76000 ROUEN » → rue, code postal, ville
function splitAddress(address = "") {
  const m = address.match(/^(.*?)[,\s]*(\d{5})\s+(.+?)\s*$/);
  return m ? { rue: m[1].trim(), cp: m[2], ville: m[3] } : { rue: address.trim(), cp: "", ville: "" };
}

function shapeWorkplace(w = {}) {
  const address = w.location?.address || "";
  return {
    nom: w.brand || w.name || w.legal_name || "",
    raisonSociale: w.legal_name || "",
    siren: /^\d{14}$/.test(w.siret || "") ? w.siret.slice(0, 9) : "",
    site: safeUrl(w.website),
    taille: w.size || "",
    activite: w.domain?.naf?.label || "",
    adresse: address,
    ...splitAddress(address),
  };
}

function shapeJob(j) {
  const offer = j.offer || {};
  const contract = j.contract || {};
  return {
    id: j.identifier?.id || j.identifier?.partner_job_id || "",
    source: j.identifier?.partner_label || "",
    titre: offer.title || "",
    description: String(offer.description || "").slice(0, 600),
    debut: contract.start || "",
    dureeMois: contract.duration ?? null,
    teletravail: contract.remote || "",
    niveau: offer.target_diploma?.label || "",
    publication: offer.publication?.creation || "",
    lien: safeUrl(j.apply?.url),
    tel: j.apply?.phone || "",
    ecole: !!j.is_delegated, // offre publiée par une école pour le compte d'une entreprise
    ...shapeWorkplace(j.workplace),
  };
}

function shapeRecruiter(r) {
  return {
    id: r.identifier?.id || "",
    lien: safeUrl(r.apply?.url),
    tel: r.apply?.phone || "",
    ...shapeWorkplace(r.workplace),
  };
}

const wrap = fn => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
};

lbaRouter.get("/status", (req, res) => res.json({ configured: !!getLbaToken() }));

lbaRouter.get("/metiers", (req, res) => res.json({ metiers: METIERS, niveaux: NIVEAUX }));

// Le jeton est vérifié par une petite recherche avant d'être enregistré.
lbaRouter.put("/token", wrap(async req => {
  const token = String(req.body?.token ?? "").trim();
  if (!/^[\x21-\x7e]{20,4096}$/.test(token)) throw fail(400, "Jeton invalide : colle-le en entier, sans espace.");
  await call("/job/v1/search", { departements: "75", romes: "M1805" }, token);
  setLbaToken(token);
  return { configured: true };
}));

lbaRouter.delete("/token", (req, res) => {
  deleteLbaToken();
  res.json({ configured: false });
});

lbaRouter.get("/recherche", wrap(async ({ query }) => {
  const dep = String(query.departement ?? "").trim().toUpperCase();
  if (!/^(\d{2,3}|2A|2B)$/.test(dep)) throw fail(400, "Département invalide");
  const romes = String(query.romes ?? "").split(",").filter(c => c in METIERS);
  if (!romes.length) throw fail(400, "Choisis au moins un métier");
  const niveau = String(query.niveau ?? "");
  const data = await call("/job/v1/search", {
    departements: dep,
    romes: romes.join(","),
    target_diploma_level: niveau in NIVEAUX ? niveau : undefined,
  });

  const sirens = knownSirens();
  const names = knownNames();
  const known = e => (e.siren && sirens.has(e.siren)) || [e.nom, e.raisonSociale].some(n => n && names.has(n.trim().toLowerCase()));
  const mark = e => ({ ...e, dejaSuivie: known(e) });

  const jobs = (data.jobs || []).map(shapeJob).map(mark)
    .sort((a, b) => String(b.publication).localeCompare(String(a.publication)));
  const recruiters = (data.recruiters || []).map(shapeRecruiter).map(mark);
  return { jobs, recruiters, warnings: (data.warnings || []).map(w => w.message) };
}));
