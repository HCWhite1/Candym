// Protections d'une application locale mono-utilisateur :
// - Host limité à localhost (bloque le DNS rebinding) ;
// - requêtes d'écriture, et lectures à appel sortant, acceptées seulement depuis la page de l'app (bloque le CSRF) ;
// - en-têtes de sécurité (CSP stricte : aucun script inline, aucune ressource externe).
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// Lectures qui déclenchent un appel sortant (API tierces, jeton personnel, boîte mail) :
// soumises au même contrôle d'origine que les écritures, sinon un site ouvert dans un autre
// onglet pourrait les lancer en boucle (sans lire la réponse) et épuiser le quota du jeton.
const OUTBOUND_PREFIXES = ["/api/lba/", "/api/annuaire/", "/api/mail/"];

export function localOnly(req, res, next) {
  if (!LOCAL_HOSTS.has(req.hostname)) {
    return res.status(421).json({ error: "Hôte non autorisé" });
  }
  const safe = SAFE_METHODS.has(req.method);
  const outbound = safe && OUTBOUND_PREFIXES.some(p => req.path.toLowerCase().startsWith(p));
  if (!safe || outbound) {
    // Navigateurs récents : Sec-Fetch-Site ; plus anciens : Origin.
    // "none" = adresse tapée dans la barre du navigateur, acceptée pour une lecture seulement.
    const site = req.get("sec-fetch-site");
    const origin = req.get("origin");
    const sameOrigin = site ? site === "same-origin" || (outbound && site === "none")
      : !origin || LOCAL_HOSTS.has(safeHostname(origin));
    if (!sameOrigin) return res.status(403).json({ error: "Requête d'origine externe refusée" });
  }
  next();
}

function safeHostname(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

export function securityHeaders(req, res, next) {
  res.set({
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
  });
  next();
}

// URL de site web : http(s) uniquement ; « exemple.fr » devient « https://exemple.fr ».
// Lève une erreur 400 pour tout autre schéma (javascript:, data:, file:…).
export function normalizeUrl(value) {
  const url = String(value ?? "").trim();
  if (!url) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : "https://" + url;
  let parsed;
  try { parsed = new URL(withScheme); } catch { parsed = null; }
  if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
    throw Object.assign(new Error("Adresse de site invalide : seules les adresses http(s) sont acceptées"), { status: 400 });
  }
  return withScheme;
}
