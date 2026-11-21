// Test d'intégration : vrai serveur (base temporaire, coffre de test), faux serveur SMTP local.
// Aucune donnée réelle n'est touchée : RADAR_DB_PATH et RADAR_KEYRING_SERVICE isolent le test.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";

const PORT = 34000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(path.join(tmpdir(), "radar-test-"));
const received = [];
let server, smtp, smtpPort, lba, lbaPort;
const lbaQueries = [];
const LBA_TOKEN = "jeton-de-test-0123456789abcdef";

// Faux La bonne alternance : même forme de réponse que /job/v1/search
const LBA_RESPONSE = {
  jobs: [{
    identifier: { id: "offre-1", partner_label: "La bonne alternance" },
    workplace: {
      name: "ACME Rouen", brand: null, legal_name: "ACME SAS", website: "acme.example", siret: "12345678900011",
      location: { address: "12 RUE DU PORT 76000 ROUEN", geopoint: { type: "Point", coordinates: [1.09, 49.44] } },
      size: "10-19", domain: { naf: { code: "6201Z", label: "Programmation informatique" } },
    },
    apply: { url: "javascript:alert(1)", phone: "0102030405" },
    contract: { start: "2026-10-01T00:00:00.000Z", duration: 24, type: ["Apprentissage"], remote: "hybrid" },
    offer: { title: "Développeur web en alternance", description: "x".repeat(900), publication: { creation: "2026-09-01T00:00:00.000Z" }, target_diploma: { european: "5", label: "BTS" } },
    is_delegated: false,
  }],
  recruiters: [{
    identifier: { id: "rec-1" },
    workplace: { name: "Déjà Suivie", legal_name: "DEJA SUIVIE SARL", siret: "98765432100019", location: { address: "1 PLACE X 76100 ROUEN" } },
    apply: { url: "https://labonnealternance.apprentissage.beta.gouv.fr/postuler/rec-1", phone: null },
  }],
  warnings: [{ code: "W", message: "Avertissement de test" }],
};

async function api(method, url, body, headers = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: { ...(body !== undefined && { "Content-Type": "application/json" }), ...headers },
    body: body === undefined ? undefined : typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

// fetch() ignore l'en-tête Host : requête brute pour simuler un DNS rebinding
const statusWithHost = (url, host) => new Promise((resolve, reject) => {
  http.get(BASE + url, { headers: { Host: host } }, res => { res.resume(); resolve(res.statusCode); }).on("error", reject);
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, what, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(250);
  }
  throw new Error("Délai dépassé : " + what);
}

before(async () => {
  smtp = new SMTPServer({
    authMethods: ["PLAIN", "LOGIN"],
    onAuth(auth, session, cb) {
      if (auth.username === "moi@example.com" && auth.password === "secret-app") return cb(null, { user: auth.username });
      cb(Object.assign(new Error("Invalid login"), { responseCode: 535 }));
    },
    onRcptTo(address, session, cb) {
      if (address.address.startsWith("refus")) return cb(Object.assign(new Error("Mailbox unavailable"), { responseCode: 550 }));
      cb();
    },
    onData(stream, session, cb) {
      simpleParser(stream).then(m => { received.push(m); cb(); }, cb);
    },
  });
  await new Promise(r => smtp.listen(0, "127.0.0.1", r));
  smtpPort = smtp.server.address().port;

  lba = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.headers.authorization !== `Bearer ${LBA_TOKEN}`) { res.writeHead(401).end(); return; }
    if (url.pathname !== "/api/job/v1/search") { res.writeHead(404).end(); return; }
    lbaQueries.push(url.searchParams);
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(LBA_RESPONSE));
  });
  await new Promise(r => lba.listen(0, "127.0.0.1", r));
  lbaPort = lba.address().port;

  server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      RADAR_DB_PATH: path.join(dir, "test.db"),
      RADAR_KEYRING_SERVICE: `radar-alternance-test-${PORT}`,
      RADAR_LBA_URL: `http://127.0.0.1:${lbaPort}/api`,
      NODE_TLS_REJECT_UNAUTHORIZED: "0", // certificat auto-signé du faux serveur SMTP
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  server.stdout.on("data", d => { out += d; });
  server.stderr.on("data", d => { out += d; });
  await waitFor(() => out.includes("Radar Alternance →"), "démarrage du serveur :\n" + out);
  // Pas de notifications Windows pendant les tests
  await api("PUT", "/api/settings", { notifWindows: false, meNom: "Hugo Test" });
});

after(async () => {
  await api("DELETE", "/api/mail/config").catch(() => {}); // nettoie le coffre de test
  await api("DELETE", "/api/lba/token").catch(() => {});
  await new Promise(r => lba.close(r));
  server?.kill();
  await new Promise(r => smtp.close(r));
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
});

test("n'écoute que sur 127.0.0.1 et refuse les autres hôtes (DNS rebinding)", async () => {
  assert.equal(await statusWithHost("/api/entreprises", `evil.example:${PORT}`), 421);
  assert.equal(await statusWithHost("/api/entreprises", `localhost:${PORT}`), 200);
  const ok = await api("GET", "/api/entreprises");
  assert.equal(ok.data.length, 0); // base neuve = seed vierge
});

test("refuse les écritures d'origine externe (CSRF)", async () => {
  assert.equal((await api("POST", "/api/reset", undefined, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await api("POST", "/api/reset", undefined, { "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await api("POST", "/api/documents", "x", { "Sec-Fetch-Site": "cross-site", "Content-Type": "text/plain" })).status, 403);
  assert.equal((await api("POST", "/api/notifications/read-all", undefined, { "Sec-Fetch-Site": "same-origin" })).status, 200);
});

test("lectures à appel sortant : réservées à la page de l'app (quota du jeton protégé)", async () => {
  for (const url of ["/api/lba/recherche?departement=76&romes=M1805", "/api/annuaire/secteurs", "/API/LBA/status"]) {
    assert.equal((await api("GET", url, undefined, { "Sec-Fetch-Site": "cross-site" })).status, 403, url);
  }
  assert.equal((await api("GET", "/api/lba/status", undefined, { "Sec-Fetch-Site": "same-origin" })).status, 200);
  assert.equal((await api("GET", "/api/lba/status", undefined, { "Sec-Fetch-Site": "none" })).status, 200); // adresse tapée
  // Les lectures purement locales restent libres
  assert.equal((await api("GET", "/api/entreprises", undefined, { "Sec-Fetch-Site": "cross-site" })).status, 200);
});

test("en-têtes de sécurité et erreurs 500 sans détail", async () => {
  const r = await api("GET", "/");
  assert.match(r.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-powered-by"), null);
  assert.equal((await api("GET", "/api/nope")).status, 404);
});

test("URL javascript: refusée, entretien validé, doublons détectés", async () => {
  const bad = await api("POST", "/api/entreprises", { nom: "Piège", url: "javascript:alert(1)" });
  assert.equal(bad.status, 400);
  const created = await api("POST", "/api/entreprises", {
    nom: "ACME Test", url: "acme.test", email: "rh@acme-test.fr", activite: "<img src=x onerror=alert(1)>",
    contactNom: "Mme Durand", dateEntretien: "2026-10-01T14:30",
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.url, "https://acme.test");
  assert.equal(created.data.contactNom, "Mme Durand");
  assert.equal((await api("PUT", `/api/entreprises/${created.data.id}`, { dateEntretien: "demain" })).status, 400);
  const d = await api("GET", "/api/entreprises/doublons?nom=autre&email=jobs@acme-test.fr");
  assert.deepEqual(d.data.map(x => x.nom), ["ACME Test"]);
  const free = await api("GET", "/api/entreprises/doublons?nom=autre&email=x@gmail.com");
  assert.equal(free.data.length, 0);
});

test("un statut invalide n'insère pas d'historique (transaction)", async () => {
  const e = (await api("GET", "/api/entreprises")).data[0];
  const r = await api("POST", `/api/entreprises/${e.id}/historique`, { type: "note", statut: "nimporte" });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "Statut inconnu"); // message métier, pas la contrainte SQLite
  const after = (await api("GET", "/api/entreprises")).data.find(x => x.id === e.id);
  assert.equal(after.historique.length, e.historique.length);
});

test("mail envoyé depuis un brouillon : contact, puis relance ; une piste n'est pas rétrogradée", async () => {
  const tpl = (await api("GET", "/api/templates")).data[0];
  const e = (await api("POST", "/api/entreprises", { nom: "Brouillon SA", email: "rh@brouillon.example" })).data;
  const first = (await api("POST", `/api/entreprises/${e.id}/envoi`, { templateId: tpl.id })).data;
  assert.equal(first.statut, "contacte");
  assert.deepEqual([first.historique[0].type, first.historique[0].moyen, first.historique[0].templateId], ["contact", "Mail", tpl.id]);
  const second = (await api("POST", `/api/entreprises/${e.id}/envoi`, {})).data;
  assert.equal(second.statut, "relancee");
  assert.equal(second.historique.at(-1).type, "relance");
  await api("PUT", `/api/entreprises/${e.id}`, { statut: "piste", reponse: true });
  const third = (await api("POST", `/api/entreprises/${e.id}/envoi`, {})).data;
  assert.equal(third.statut, "piste");
  assert.equal(third.reponse, false);
  assert.equal((await api("POST", "/api/entreprises/999999/envoi", {})).status, 404);
  await api("DELETE", `/api/entreprises/${e.id}`);
});

test("le marqueur « réponse reçue » suit le statut, sauf valeur explicite", async () => {
  const e = (await api("POST", "/api/entreprises", { nom: "Marqueur SA", statut: "refusee" })).data;
  assert.equal(e.reponse, true);
  const put = async patch => (await api("PUT", `/api/entreprises/${e.id}`, patch)).data;
  assert.equal((await put({ statut: "contacte" })).reponse, false); // recontactée : de nouveau en attente
  assert.equal((await put({ statut: "piste" })).reponse, true);
  assert.equal((await put({ statut: "fermee" })).reponse, true); // « fermée » ne dit rien de la réponse
  assert.equal((await put({ statut: "piste", reponse: false })).reponse, false); // la valeur explicite gagne
  await put({ statut: "acceptee" });
  const logged = (await api("POST", `/api/entreprises/${e.id}/historique`, { type: "contact", statut: "contacte" })).data;
  assert.equal(logged.reponse, false);
  assert.equal((await put({ activite: null })).activite, ""); // null n'écrit pas « null »
  await api("DELETE", `/api/entreprises/${e.id}`);
});

test("coffre : place occupée par le coffre, la base et les sauvegardes", async () => {
  const u = (await api("GET", "/api/documents/usage")).data;
  assert.equal(typeof u.vaultBytes, "number");
  assert.equal(u.vaultMaxBytes, 2048 * 1048576);
  assert.ok(u.dbBytes > 0);
  assert.equal(typeof u.coffreBytes, "number");
  assert.equal(u.backups.kept, 5);
  assert.equal(typeof u.backups.bytes, "number");
});

test("coffre : fichier rangé une seule fois dans coffre/, supprimé quand plus rien ne le cite", async () => {
  const coffreDir = path.join(dir, "coffre");
  const bytes = new Uint8Array([0, 1, 2, 250, 255, ...new TextEncoder().encode("lettre de motivation")]);
  const up = name => api("POST", "/api/documents", bytes, { "Content-Type": "application/pdf", "X-Filename": encodeURIComponent(name) });
  const a = (await up("Lettre A.pdf")).data, b = (await up("Lettre B.pdf")).data;
  const files = () => readdirSync(coffreDir).filter(f => /^[0-9a-f]{64}$/.test(f));
  const hash = createHash("sha256").update(bytes).digest("hex");
  assert.ok(files().includes(hash), "contenu rangé sous son empreinte");
  assert.equal(files().filter(f => f === hash).length, 1);

  const dl = await fetch(`${BASE}/api/documents/${a.id}/download`);
  assert.equal(dl.headers.get("content-type"), "application/pdf");
  assert.match(dl.headers.get("content-disposition"), /Lettre%20A\.pdf/);
  assert.deepEqual(new Uint8Array(await dl.arrayBuffer()), bytes);

  // Aperçu : inline, encadrable par l'app seule, sans script
  const pv = await fetch(`${BASE}/api/documents/${a.id}/preview`);
  assert.equal(pv.status, 200);
  assert.equal(pv.headers.get("content-type"), "application/pdf");
  assert.match(pv.headers.get("content-disposition"), /^inline;/);
  assert.equal(pv.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.match(pv.headers.get("content-security-policy"), /default-src 'none'.*frame-ancestors 'self'/);
  const svg = (await api("POST", "/api/documents", new TextEncoder().encode("<svg/>"), { "Content-Type": "image/svg+xml", "X-Filename": "logo.svg" })).data;
  assert.equal((await fetch(`${BASE}/api/documents/${svg.id}/preview`)).status, 415, "SVG jamais servi inline");
  assert.equal((await api("DELETE", `/api/documents/${svg.id}`)).status, 204);

  assert.equal((await api("DELETE", `/api/documents/${a.id}`)).status, 204);
  assert.ok(files().includes(hash), "encore cité par le document B");
  assert.equal((await api("DELETE", `/api/documents/${b.id}`)).status, 204);
  assert.ok(!files().includes(hash), "plus cité : supprimé");
});

test("mot de passe : jamais renvoyé, effacé si un serveur ou l'adresse change", async () => {
  let r = await api("PUT", "/api/mail/config", {
    host: "127.0.0.1", port: 1, user: "moi@example.com", pass: "secret-app",
    smtpHost: "127.0.0.1", smtpPort: smtpPort, pollMinutes: 120,
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.hasPassword, true);
  assert.equal(JSON.stringify(r.data).includes("secret-app"), false);

  // Même configuration renvoyée sans mot de passe : conservé
  r = await api("PUT", "/api/mail/config", { host: "127.0.0.1", user: "moi@example.com", smtpHost: "127.0.0.1" });
  assert.equal(r.data.hasPassword, true);
  assert.equal(r.data.passwordCleared, false);

  // Serveur SMTP détourné sans ressaisie : mot de passe effacé
  r = await api("PUT", "/api/mail/config", { smtpHost: "smtp.attaquant.example" });
  assert.equal(r.data.passwordCleared, true);
  assert.equal(r.data.hasPassword, false);
  assert.equal((await api("POST", "/api/mail/test-smtp")).status, 400);

  // Remise en état pour la suite
  r = await api("PUT", "/api/mail/config", { smtpHost: "127.0.0.1", smtpPort: smtpPort, pass: "secret-app" });
  assert.equal(r.data.hasPassword, true);
  const t = await api("POST", "/api/mail/test-smtp");
  assert.equal(t.status, 200, JSON.stringify(t.data));
});

test("mauvais identifiants SMTP : message explicite", async () => {
  await api("PUT", "/api/mail/config", { pass: "mauvais" });
  const t = await api("POST", "/api/mail/test-smtp");
  assert.equal(t.status, 400);
  assert.match(t.data.error, /mot de passe d'application est invalide/);
  await api("PUT", "/api/mail/config", { pass: "secret-app" });
});

test("envoi SMTP immédiat : pièce jointe, expéditeur, traçage dans l'historique", async () => {
  const doc = await api("POST", "/api/documents", new TextEncoder().encode("%PDF-1.4 faux cv"), {
    "Content-Type": "application/pdf", "X-Filename": encodeURIComponent("CV Hugo.pdf"),
  });
  assert.equal(doc.status, 201);
  const ent = (await api("GET", "/api/entreprises")).data.find(e => e.nom === "ACME Test");
  const tpl = (await api("GET", "/api/templates")).data.find(t => t.kind === "candidature");

  // Trou [..] restant : refusé sans confirmation
  const hole = await api("POST", "/api/outbox", { items: [{ entrepriseId: ent.id, subject: "Poste [intitulé]", body: "x" }] });
  assert.equal(hole.status, 400);
  assert.match(hole.data.error, /\[intitulé\]/);

  const r = await api("POST", "/api/outbox", {
    items: [{ entrepriseId: ent.id, subject: "Candidature ACME", body: "Bonjour Mme Durand" }],
    attachments: [doc.data.id],
    templateId: tpl.id,
  });
  assert.equal(r.status, 201);

  const sent = await waitFor(async () => (await api("GET", "/api/outbox")).data.find(o => o.id === r.data.ids[0] && o.status === "sent"), "envoi SMTP");
  assert.ok(sent.sentAt);
  const mail = received.find(m => m.subject === "Candidature ACME");
  assert.ok(mail, "mail reçu par le faux serveur");
  assert.equal(mail.from.value[0].address, "moi@example.com");
  assert.equal(mail.from.value[0].name, "Hugo Test");
  assert.equal(mail.to.value[0].address, "rh@acme-test.fr");
  assert.equal(mail.attachments[0].filename, "CV Hugo.pdf");

  const after = (await api("GET", "/api/entreprises")).data.find(e => e.id === ent.id);
  const last = after.historique.at(-1);
  assert.equal(last.type, "contact");
  assert.equal(last.templateId, tpl.id);
  assert.equal(after.statut, "contacte");

  const stats = (await api("GET", "/api/stats")).data;
  assert.equal(stats.parModele.find(t => t.id === tpl.id)?.envois, 1);
});

test("second envoi à la même entreprise = relance ; supprimer un document joint demande confirmation", async () => {
  const ent = (await api("GET", "/api/entreprises")).data.find(e => e.nom === "ACME Test");
  const doc = (await api("GET", "/api/documents")).data[0];
  const future = new Date(Date.now() + 3 * 86400000).toISOString();
  const r = await api("POST", "/api/outbox", {
    items: [{ entrepriseId: ent.id, subject: "Relance", body: "..." }], sendAt: future, attachments: [doc.id],
  });
  const id = r.data.ids[0];
  assert.equal((await api("GET", "/api/outbox")).data.find(o => o.id === id).status, "pending");
  assert.equal((await api("DELETE", `/api/documents/${doc.id}`)).status, 409);
  assert.equal((await api("DELETE", `/api/outbox/${id}`)).status, 204);
  assert.equal((await api("GET", "/api/outbox")).data.find(o => o.id === id).status, "cancelled");

  // Relancé maintenant → part et compte comme relance
  assert.equal((await api("POST", `/api/outbox/${id}/retry`)).status, 200);
  await waitFor(async () => (await api("GET", "/api/outbox")).data.find(o => o.id === id && o.status === "sent"), "relance SMTP");
  const after = (await api("GET", "/api/entreprises")).data.find(e => e.id === ent.id);
  assert.equal(after.historique.at(-1).type, "relance");
  assert.equal(after.statut, "relancee");
});

test("destinataire refusé : envoi en échec avec l'erreur, puis nouvel essai possible", async () => {
  const created = await api("POST", "/api/entreprises", { nom: "Refus SA", email: "refus@refus.example" });
  const r = await api("POST", "/api/outbox", {
    items: [{ entrepriseId: created.data.id, subject: "Test échec", body: "..." }],
  });
  const failed = await waitFor(async () => (await api("GET", "/api/outbox")).data.find(o => o.id === r.data.ids[0] && o.status === "failed"), "échec SMTP");
  assert.match(failed.error, /Mailbox unavailable|550/);
  const ent = (await api("GET", "/api/entreprises")).data.find(e => e.id === created.data.id);
  assert.equal(ent.historique.length, 0, "un échec n'est pas tracé comme contact");
  assert.equal((await api("POST", `/api/outbox/${r.data.ids[0]}/retry`)).status, 200);
  await waitFor(async () => (await api("GET", "/api/outbox")).data.find(o => o.id === r.data.ids[0] && o.status === "failed"), "second échec");
});

test("envoi programmé et espacé", async () => {
  let list = (await api("GET", "/api/entreprises")).data.filter(e => e.email).slice(0, 3);
  while (list.length < 3) {
    const created = await api("POST", "/api/entreprises", { nom: `Prog ${list.length + 1}`, email: `prog${list.length + 1}@example.com` });
    list.push(created.data);
  }
  const start = new Date(Date.now() + 86400000);
  const r = await api("POST", "/api/outbox", {
    items: list.map(e => ({ entrepriseId: e.id, subject: "Programmé", body: "..." })),
    sendAt: start.toISOString(),
    spacingMinutes: 10,
  });
  const rows = (await api("GET", "/api/outbox")).data.filter(o => r.data.ids.includes(o.id)).sort((a, b) => a.id - b.id);
  assert.deepEqual(rows.map(o => (new Date(o.sendAt) - start) / 60000), [0, 10, 20]);
  for (const id of r.data.ids) await api("DELETE", `/api/outbox/${id}`);
  assert.equal((await api("POST", "/api/outbox", { items: [{ entrepriseId: list[0].id, subject: "x" }], sendAt: "2099-01-01" })).status, 400);
  // Pièces jointes mal formées : ignorées, pas d'erreur 500
  const odd = await api("POST", "/api/outbox", { items: [{ entrepriseId: list[0].id, subject: "x" }], sendAt: start.toISOString(), attachments: "x" });
  assert.equal(odd.status, 201, JSON.stringify(odd.data));
  for (const id of odd.data.ids) await api("DELETE", `/api/outbox/${id}`);
  // JSON mal formé : message en français
  const broken = await api("POST", "/api/outbox", "{pas du json");
  assert.equal(broken.status, 400);
  assert.match(broken.data.error, /JSON mal formé/);
});

test("test à soi-même", async () => {
  const r = await api("POST", "/api/outbox/test", { subject: "Aperçu", body: "Corps" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(received.some(m => m.subject === "[TEST] Aperçu" && m.to.value[0].address === "moi@example.com"));
});

test("modèles : type obligatoire valide", async () => {
  assert.equal((await api("POST", "/api/templates", { name: "X", kind: "bizarre" })).status, 400);
  const t = await api("POST", "/api/templates", { name: "Relance 2", kind: "relance", subject: "s", body: "b" });
  assert.equal(t.data.kind, "relance");
});

test("réinitialisation : aperçu chiffré, puis envois orphelins annulés", async () => {
  const ent = (await api("GET", "/api/entreprises")).data.find(e => e.nom === "ACME Test");
  const future = new Date(Date.now() + 86400000).toISOString();
  const q = await api("POST", "/api/outbox", { items: [{ entrepriseId: ent.id, subject: "Orphelin", body: "..." }], sendAt: future });
  const info = (await api("GET", "/api/reset")).data;
  assert.equal(info.seedEntreprises, 0);
  assert.equal(info.envoisProgrammes, 1);
  assert.equal((await api("POST", "/api/reset")).status, 200);
  assert.equal((await api("GET", "/api/entreprises")).data.length, 0);
  const o = (await api("GET", "/api/outbox")).data.find(x => x.id === q.data.ids[0]);
  assert.equal(o.status, "cancelled");
});

test("import JSON : URL invalide neutralisée, modèles conservés avec leurs ids", async () => {
  const templates = (await api("GET", "/api/templates")).data;
  const r = await api("POST", "/api/import", {
    entreprises: [{ nom: "Importée", url: "javascript:alert(1)", historique: [{ date: "2026-01-01", type: "contact", templateId: templates[0].id }] }],
    templates,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const list = (await api("GET", "/api/entreprises")).data;
  assert.equal(list.length, 1);
  assert.equal(list[0].url, "");
  assert.equal(list[0].historique[0].templateId, templates[0].id);
});

test("La bonne alternance : jeton vérifié avant d'être gardé, résultats nettoyés", async () => {
  assert.equal((await api("GET", "/api/lba/status")).data.configured, false);
  const sans = await api("GET", "/api/lba/recherche?departement=76&romes=M1805");
  assert.equal(sans.status, 400);
  assert.match(sans.data.error, /Aucun jeton/);

  assert.equal((await api("PUT", "/api/lba/token", { token: "trop court" })).status, 400);
  const refuse = await api("PUT", "/api/lba/token", { token: "mauvais-jeton-0123456789abcdef" });
  assert.equal(refuse.status, 400);
  assert.match(refuse.data.error, /Jeton refusé/);
  assert.equal((await api("GET", "/api/lba/status")).data.configured, false, "jeton refusé : rien d'enregistré");

  assert.equal((await api("PUT", "/api/lba/token", { token: LBA_TOKEN })).status, 200);
  const status = await api("GET", "/api/lba/status");
  assert.deepEqual(status.data, { configured: true }, "le jeton n'est jamais renvoyé");

  await api("POST", "/api/entreprises", { nom: "Déjà suivie", statut: "a_evaluer" });
  assert.equal((await api("GET", "/api/lba/recherche?departement=7&romes=M1805")).status, 400);
  assert.equal((await api("GET", "/api/lba/recherche?departement=76&romes=X9999")).status, 400);
  const r = await api("GET", "/api/lba/recherche?departement=76&romes=M1805,M1810,X9999&niveau=5");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const q = lbaQueries.at(-1);
  assert.equal(q.get("departements"), "76");
  assert.equal(q.get("romes"), "M1805,M1810");
  assert.equal(q.get("target_diploma_level"), "5");

  const [job] = r.data.jobs;
  assert.equal(job.titre, "Développeur web en alternance");
  assert.equal(job.nom, "ACME Rouen");
  assert.deepEqual([job.rue, job.cp, job.ville], ["12 RUE DU PORT", "76000", "ROUEN"]);
  assert.equal(job.siren, "123456789");
  assert.equal(job.site, "https://acme.example");
  assert.equal(job.lien, "", "lien javascript: neutralisé");
  assert.equal(job.description.length, 600);
  assert.equal(job.dejaSuivie, false);
  const [rec] = r.data.recruiters;
  assert.equal(rec.dejaSuivie, true, "reconnue par son nom");
  assert.ok(rec.lien.startsWith("https://labonnealternance"));
  assert.deepEqual(r.data.warnings, ["Avertissement de test"]);

  assert.equal((await api("DELETE", "/api/lba/token")).status, 200);
  assert.equal((await api("GET", "/api/lba/status")).data.configured, false);
});
