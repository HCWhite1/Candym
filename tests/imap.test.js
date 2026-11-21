// Test d'intégration de la relève IMAP contre un faux serveur (hoodiecrow-imap).
// Dépendance de test optionnelle, non installée par défaut (paquet ancien) :
//   npm install --no-save hoodiecrow-imap@2.1.0 && npm test
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let hoodiecrow = null;
try { hoodiecrow = (await import("hoodiecrow-imap")).default; } catch { /* test ignoré */ }
const skip = hoodiecrow ? false : "hoodiecrow-imap non installé (npm install --no-save hoodiecrow-imap@2.1.0)";

const PORT = 35000 + Math.floor(Math.random() * 1000);
const IMAP_PORT = PORT + 1000;
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(path.join(tmpdir(), "radar-imap-"));
let server, imap;

const api = async (method, url, body) => {
  const res = await fetch(BASE + url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
};

const mail = (from, subject, body, id) => ({
  raw: `From: ${from}\r\nTo: moi@example.com\r\nSubject: ${subject}\r\nMessage-ID: <${id}@test>\r\n`
    + `Date: ${new Date().toUTCString()}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n`
    + Buffer.from(body).toString("base64").replace(/.{76}/g, "$&\r\n") + "\r\n",
  internaldate: new Date(),
});

const QUOTE = "\r\n\r\nLe mar. 15 sept. 2026 à 10:02, Moi <moi@example.com> a écrit :\r\n> Je reste disponible pour un entretien.";

before(async () => {
  if (skip) return;
  imap = hoodiecrow({
    plugins: ["ID", "STARTTLS", "SASL-IR", "AUTH-PLAIN", "NAMESPACE", "IDLE", "ENABLE", "CONDSTORE", "UNSELECT", "LITERALPLUS"],
    storage: {
      INBOX: {
        messages: [
          mail("rh@acme-imap.fr", "RE: Candidature alternance", "Bonjour, nous souhaiterions vous rencontrer. Quelles sont vos disponibilités ?" + QUOTE, "m1"),
          mail("jobs@beta-imap.fr", "RE: Candidature", "Nous ne pouvons pas donner suite à votre candidature." + QUOTE, "m2"),
          mail("patron@gmail.com", "RE: Candidature", "Bien reçu, merci." + QUOTE, "m3"),
          mail("inconnu@ailleurs.fr", "Promo", "Achetez maintenant, entretien offert", "m4"),
          mail("rh@acme-imap.fr", "Réponse automatique : absent du bureau", "Je suis absent.", "m5"),
          mail("moi@example.com", "Copie", "mon propre message", "m6"),
        ],
      },
    },
    users: { moi: { password: "pw" } },
  });
  await new Promise(r => imap.listen(IMAP_PORT, r));

  server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      RADAR_DB_PATH: path.join(dir, "imap.db"),
      RADAR_KEYRING_SERVICE: `radar-alternance-test-${PORT}`,
      NODE_TLS_REJECT_UNAUTHORIZED: "0", // certificat auto-signé du faux serveur (STARTTLS)
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  server.stdout.on("data", d => { out += d; });
  server.stderr.on("data", d => { out += d; });
  for (let i = 0; i < 60 && !out.includes("Radar Alternance →"); i++) await new Promise(r => setTimeout(r, 200));
  await api("PUT", "/api/settings", { notifWindows: false });
});

after(async () => {
  if (skip) return;
  await api("DELETE", "/api/mail/config").catch(() => {});
  server?.kill();
  imap?.close?.();
  await new Promise(r => setTimeout(r, 300));
  rmSync(dir, { recursive: true, force: true });
});

test("relève IMAP : rapprochement, classement, absences et soi-même ignorés", { skip }, async () => {
  const mk = (nom, email) => api("POST", "/api/entreprises", { nom, email, statut: "contacte" }).then(r => r.data);
  const a = await mk("Acme Imap", "rh@acme-imap.fr");
  const b = await mk("Beta Imap", "contact@beta-imap.fr");
  const c = await mk("Patron Gmail", "patron@gmail.com");

  // Port 143 + STARTTLS obligatoire
  const cfg = await api("PUT", "/api/mail/config", { host: "127.0.0.1", port: IMAP_PORT, user: "moi@example.com", pass: "pw", pollMinutes: 120 });
  assert.equal(cfg.status, 200);

  // Mauvais identifiants : message explicite
  await api("PUT", "/api/mail/config", { pass: "faux" });
  const bad = await api("POST", "/api/mail/test");
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /Identifiants refusés/);

  // hoodiecrow authentifie par nom d'utilisateur « moi »
  await api("PUT", "/api/mail/config", { user: "moi", pass: "pw" });
  const ok = await api("POST", "/api/mail/test");
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.messages, 6);

  const r = await api("POST", "/api/mail/check");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.scanned, 6);
  assert.equal(r.data.matched, 3);

  const list = (await api("GET", "/api/entreprises")).data;
  const get = id => list.find(e => e.id === id);
  assert.equal(get(a.id).statut, "piste");
  assert.equal(get(b.id).statut, "refusee");
  assert.equal(get(c.id).statut, "contacte", "un accusé de réception ne change pas le statut");
  assert.equal(get(a.id).historique.filter(h => h.type === "reponse").length, 1, "le message d'absence n'est pas une réponse");
  assert.equal(get(c.id).historique.filter(h => h.type === "reponse").length, 1);

  const notifs = (await api("GET", "/api/notifications")).data;
  assert.equal(notifs.length, 3);
  const nc = notifs.find(n => n.entrepriseId === c.id);
  assert.equal(nc.classement, null);
  assert.equal(nc.snippet, "Bien reçu, merci.", "l'extrait ne contient pas la citation");

  // Deuxième relève : rien de nouveau (dernier UID mémorisé)
  const again = await api("POST", "/api/mail/check");
  assert.equal(again.data.scanned, 0);
  assert.equal(again.data.matched, 0);
});
