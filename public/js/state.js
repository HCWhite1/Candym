// État partagé de l'app : miroir en mémoire de la base, filtres, sélection.
// Chaque mutation appelle l'API puis répercute la réponse serveur dans l'état local.
import { api } from "./api.js";

export const state = {
  entreprises: [],
  templates: [],
  settings: { delaiRelance: 7, mailOpenMode: "gmail", meNom: "", meTel: "", notifWindows: true, customPortals: [] },
  mail: { user: "", configured: false }, // Réglages → Boîte mail (sert aussi à ouvrir Gmail sur le bon compte)
  unread: [], // notifications non lues (tenu à jour par ui/notifications.js, lu par la vue « Aujourd'hui »)
  loaded: false, // premier chargement terminé : avant, une liste vide ne veut pas dire « rien à faire »
};

export const filter = { q: "", statut: null, relanceOnly: false, tag: "" };
export const selection = new Set();

// Vue principale : "table" ou "kanban" (mémorisée dans le navigateur)
export const view = {
  get mode() {
    try { return localStorage.getItem("radar.view") === "kanban" ? "kanban" : "table"; } catch { return "table"; }
  },
  set mode(v) {
    try { localStorage.setItem("radar.view", v); } catch { /* stockage indisponible */ }
  },
};

export const byId = id => state.entreprises.find(e => e.id === Number(id));

// Identité de l'expéditeur, pour les variables {moi.*}
export const me = () => ({ nom: state.settings.meNom, tel: state.settings.meTel, email: state.mail.user });

export const isSmtpMode = () => state.settings.mailOpenMode === "smtp";

// Modèle ouvert par « Relancer » : le premier de type relance
export const relanceTemplate = () => state.templates.find(t => t.kind === "relance") || null;

export async function loadAll() {
  const [entreprises, templates, settings, mailCfg] = await Promise.all([
    api.entreprises.list(),
    api.templates.list(),
    api.settings.get(),
    api.mail.getConfig().catch(() => ({ user: "", configured: false })),
  ]);
  state.entreprises = entreprises;
  state.templates = templates;
  Object.assign(state.settings, settings);
  state.mail = { user: mailCfg.user || "", configured: !!mailCfg.configured };
  state.loaded = true;
}

export async function reloadEntreprises() {
  state.entreprises = await api.entreprises.list();
}

/* ---------- Logique métier ---------- */

// Date du dernier échange (contact, relance ou réponse), ou null.
// Mémorisée par entreprise : chaque rendu la demande plusieurs fois par ligne (tri, filtre, affichage).
// Le cache suit l'objet : une entreprise modifiée est remplacée par la réponse du serveur, donc recalculée.
const lastContactCache = new WeakMap();
export function lastContact(e) {
  if (lastContactCache.has(e)) return lastContactCache.get(e);
  let max = null;
  for (const h of e.historique || []) {
    if ((h.type === "contact" || h.type === "relance" || h.type === "reponse") && (!max || h.date > max)) max = h.date;
  }
  const d = max ? new Date(max) : null;
  lastContactCache.set(e, d);
  return d;
}

export function needsRelance(e) {
  if (!["contacte", "relancee"].includes(e.statut) || e.reponse) return false;
  const lc = lastContact(e);
  if (!lc) return false;
  return Date.now() - lc.getTime() > state.settings.delaiRelance * 86400000;
}

// Un envoi vers une entreprise déjà contactée compte comme une relance
export const isRelanceFor = e => (e.historique || []).some(h => h.type === "contact");

/* ---------- Mutations (API + état local) ----------
   Le marqueur « réponse reçue » n'est jamais envoyé avec un statut : le serveur le déduit
   (règle unique : src/routes/entreprises.js → REPONSE_PAR_STATUT). */

function upsertLocal(updated) {
  const i = state.entreprises.findIndex(e => e.id === updated.id);
  if (i >= 0) state.entreprises[i] = updated;
  else state.entreprises.push(updated);
  return updated;
}

export async function createEntreprise(data) {
  return upsertLocal(await api.entreprises.create(data));
}

export async function updateEntreprise(id, patch) {
  return upsertLocal(await api.entreprises.update(id, patch));
}

export async function deleteEntreprise(id) {
  await api.entreprises.remove(id);
  state.entreprises = state.entreprises.filter(e => e.id !== Number(id));
  selection.delete(Number(id));
}

// Passer manuellement en "contacté", "relancé" ou "piste" vaut comme un échange du jour :
// le "dernier contact" doit refléter aujourd'hui plutôt que rester à "jamais"/une ancienne date.
const LOG_ON_STATUT = { contacte: "contact", relancee: "relance", piste: "reponse" };

export async function changeStatut(e, statut) {
  const type = LOG_ON_STATUT[statut];
  if (type) return logContact(e.id, { type, moyen: type === "reponse" ? "" : "Manuel", statut });
  return updateEntreprise(e.id, { statut });
}

export async function logContact(id, entry) {
  return upsertLocal(await api.entreprises.log(id, entry));
}

// Enregistre un mail envoyé depuis un brouillon. Le serveur décide seul s'il s'agit d'un
// 1er contact ou d'une relance, et du statut (règle unique : src/routes/entreprises.js → recordMailSent).
export async function markContacted(id, templateId = null) {
  return upsertLocal(await api.entreprises.mailSent(id, { templateId }));
}
