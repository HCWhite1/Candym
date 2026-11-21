import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb } from "./db.js";
import { localOnly, securityHeaders } from "./security.js";
import { migrateLegacyPassword } from "./secrets.js";
import { sseHandler } from "./events.js";
import { schedulePolling, stopPolling } from "./mail.js";
import { startOutbox, stopOutbox } from "./smtp.js";
import { scheduleReminders, setAppUrl } from "./notify.js";
import { entreprisesRouter } from "./routes/entreprises.js";
import { templatesRouter } from "./routes/templates.js";
import { documentsRouter } from "./routes/documents.js";
import { settingsRouter } from "./routes/settings.js";
import { dataRouter } from "./routes/data.js";
import { mailRouter } from "./routes/mail.js";
import { notificationsRouter } from "./routes/notifications.js";
import { outboxRouter } from "./routes/outbox.js";
import { annuaireRouter } from "./routes/annuaire.js";
import { lbaRouter } from "./routes/lba.js";
import { statsRouter } from "./routes/stats.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// Application personnelle : elle n'écoute que sur la machine locale, jamais sur le réseau.
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT) || 3400;
const URL_APP = `http://localhost:${PORT}`;

if (migrateLegacyPassword()) {
  console.log("Mot de passe mail déplacé de la base vers le Gestionnaire d'identifiants Windows.");
}

const app = express();
app.disable("x-powered-by");
app.use(localOnly);
app.use(securityHeaders);
app.use(express.json({ limit: "10mb" }));

app.get("/api/events", sseHandler);
app.use("/api/entreprises", entreprisesRouter);
app.use("/api/templates", templatesRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/mail", mailRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/outbox", outboxRouter);
app.use("/api/annuaire", annuaireRouter);
app.use("/api/lba", lbaRouter);
app.use("/api/stats", statsRouter);
app.use("/api", dataRouter);
app.use("/api", (req, res) => res.status(404).json({ error: "Route inconnue" }));

app.use(express.static(path.join(ROOT, "public")));

// Contrainte SQLite violée → message lisible, sans relayer le nom de la contrainte ni le schéma.
const CONSTRAINT_MESSAGES = [
  [/^CHECK .*\bstatut IN\b/, "Statut inconnu"],
  [/^CHECK .*\bpertinence IN\b/, "Pertinence inconnue (haute, moyenne, faible ou vide)"],
  [/^CHECK .*\bkind IN\b/, "Type de modèle inconnu"],
  [/^CHECK .*\btype IN\b/, "Type d'échange inconnu"],
  [/^CHECK .*\bclassement IN\b/, "Classement inconnu"],
  [/^FOREIGN KEY/, "Élément lié introuvable : il a peut-être été supprimé entre-temps"],
  [/^UNIQUE/, "Cet élément existe déjà"],
  [/^NOT NULL/, "Champ obligatoire manquant"],
];
const constraintMessage = msg => CONSTRAINT_MESSAGES.find(([re]) => re.test(msg))?.[1] || "Donnée invalide";

// Toute erreur (contrainte SQL, JSON malformé…) ressort en JSON pour le front.
// Une contrainte violée (CHECK, FK…) vient d'une donnée invalide → 400.
app.use((err, req, res, next) => {
  // Erreurs du lecteur de corps (Express) : message en français plutôt que le texte anglais par défaut
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Fichier ou requête trop volumineux (25 Mo maximum)" });
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Requête invalide (JSON mal formé)" });
  const isConstraint = err.code === "ERR_SQLITE_ERROR" && /constraint/i.test(err.message);
  const status = err.status || err.statusCode || (isConstraint ? 400 : 500);
  if (status >= 500) console.error(err);
  const error = status >= 500 ? "Erreur serveur" : isConstraint ? constraintMessage(err.message) : err.message;
  res.status(status).json({ error });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Radar Alternance → ${URL_APP}`);
  setAppUrl(URL_APP);
  schedulePolling(); // relève mail périodique, si une boîte est configurée
  startOutbox();     // envois SMTP programmés
  scheduleReminders();
});
server.on("error", err => {
  if (err.code === "EADDRINUSE") {
    console.error(`Le port ${PORT} est déjà utilisé : Radar Alternance tourne peut-être déjà (${URL_APP}).`);
    process.exit(1);
  }
  throw err;
});

// Arrêt propre (Ctrl+C, fermeture de la fenêtre) : la base est fermée et son journal vidé.
function shutdown() {
  stopPolling();
  stopOutbox();
  server.close();
  server.closeAllConnections?.();
  closeDb();
  process.exit(0);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) process.on(sig, shutdown);
