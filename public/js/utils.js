export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- Gabarits HTML échappés par défaut ----------
   html`<b>${nom}</b>` échappe toute valeur interpolée ; seuls les fragments produits
   par html`` ou raw() sont insérés tels quels. Les tableaux sont concaténés ;
   null, undefined et false ne produisent rien (pratique pour `cond && html`...``). */
class Html {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = s => new Html(String(s ?? ""));
const part = v => v instanceof Html ? v.s
  : Array.isArray(v) ? v.map(part).join("")
  : v === null || v === undefined || v === false ? "" : esc(v);
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return new Html(out);
}

// Lien sûr : http(s) uniquement (bloque javascript:, data:…) ; « site.fr » → https://site.fr
export function safeUrl(u) {
  const s = String(u ?? "").trim();
  if (!s) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : "https://" + s;
  try {
    const p = new URL(withScheme);
    return p.protocol === "http:" || p.protocol === "https:" ? p.href : "";
  } catch { return ""; }
}

export const telHref = tel => "tel:" + String(tel || "").replace(/[^+\d]/g, "");

export function toast(msg, kind = "ok") {
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.setAttribute("role", kind === "err" ? "alert" : "status");
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => {
    t.classList.add("leaving");
    setTimeout(() => t.remove(), 320);
  }, kind === "err" ? 6000 : 3400);
}

// Exécute une action asynchrone en désactivant son bouton le temps de la requête
// (un double clic sur « Envoyé » traçait deux fois le même mail) ; l'erreur éventuelle part en toast.
// Renvoie true si l'action a réussi.
export async function busy(btn, fn) {
  if (btn?.disabled) return false;
  if (btn) btn.disabled = true;
  try {
    await fn();
    return true;
  } catch (err) {
    toast(err.message, "err");
    return false;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Ancienneté lisible, d'autant moins précise qu'elle est grande :
// "à l'instant" / "il y a 5 min" / "il y a 3 h 12" / "il y a 2 j 7 h" / "il y a 12 j" / "il y a 3 mois" / "il y a 2 ans"
export function rel(dateObj, now = Date.now()) {
  if (!dateObj) return null;
  const ms = Math.max(0, now - dateObj.getTime());
  const j = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (j >= 730) return `il y a ${Math.floor(j / 365)} ans`;
  if (j >= 60) return `il y a ${Math.floor(j / 30.44)} mois`;
  if (j >= 7) return `il y a ${j} j`;
  if (j > 0) return h ? `il y a ${j} j ${h} h` : `il y a ${j} j`;
  if (h > 0) return `il y a ${h} h ${String(m).padStart(2, "0")}`;
  return m > 0 ? `il y a ${m} min` : "à l'instant";
}

export function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(iso) {
  return new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function fmtSize(n) {
  if (n > 1073741824) return (n / 1073741824).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " Go";
  if (n > 1048576) return (n / 1048576).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " Mo";
  if (n > 1024) return Math.round(n / 1024) + " Ko";
  return n + " o";
}

// Valeur d'un <input type="datetime-local"> (heure locale, à la minute)
export function toLocalInput(d) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Substitue les variables d'un modèle pour un destinataire donné.
// `me` : { nom, tel, email } (Réglages → Identité et Boîte mail)
export function applyVars(text, e, me = {}) {
  return String(text || "")
    .replaceAll("{entreprise}", e.nom || "")
    .replaceAll("{ville}", e.ville || "votre région")
    .replaceAll("{activite}", e.activite || "")
    .replaceAll("{interlocuteur}", e.contactNom || "Madame, Monsieur")
    .replaceAll("{moi.nom}", me.nom || "")
    .replaceAll("{moi.tel}", me.tel || "")
    .replaceAll("{moi.email}", me.email || "");
}

// Variables {moi.*} utilisées alors que l'identité n'est pas renseignée
export function missingIdentity(text, me = {}) {
  const s = String(text || "");
  return [["{moi.nom}", me.nom, "ton nom"], ["{moi.tel}", me.tel, "ton téléphone"], ["{moi.email}", me.email, "ton adresse mail"]]
    .filter(([v, val]) => s.includes(v) && !val).map(([, , label]) => label);
}

// Premier trou « [à compléter] » restant, ou null (règle partagée avec le serveur)
export { findPlaceholder } from "./shared.js";

// Téléchargement d'un fichier généré côté navigateur
export function download(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Cellule CSV sûre : guillemets doublés, et une formule (= + - @) neutralisée
// pour qu'un tableur ne l'exécute pas à l'ouverture.
export const csvCell = v => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};

// Fichier .ics (un événement) pour ajouter un entretien à un agenda
export function icsEvent({ uid, start, minutes = 60, title, location = "", description = "" }) {
  const utc = d => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const text = s => String(s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, m => "\\" + m);
  const end = new Date(start.getTime() + minutes * 60000);
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Radar Alternance//FR", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(end)}`,
    `SUMMARY:${text(title)}`,
    location && `LOCATION:${text(location)}`,
    description && `DESCRIPTION:${text(description)}`,
    "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", `DESCRIPTION:${text(title)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean).join("\r\n") + "\r\n";
}
