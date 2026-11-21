// Envoi direct par SMTP (mode « smtp » des réglages) : file d'envoi persistante,
// envois programmés et espacés, pièces jointes du coffre. Un envoi n'est tracé
// dans l'historique (contact ou relance) qu'une fois accepté par le serveur SMTP.
import nodemailer from "nodemailer";
import { db, coffre, getSetting, transaction } from "./db.js";
import { findPlaceholder } from "../public/js/shared.js";
import { recordMailSent } from "./routes/entreprises.js";
import { getMailConfig, isConfigured } from "./mail.js";
import { emit } from "./events.js";
import { showToast } from "./notify.js";

const badRequest = msg => Object.assign(new Error(msg), { status: 400 });

function transport(cfg = getMailConfig()) {
  if (!isConfigured(cfg)) throw badRequest("Boîte mail non configurée (Réglages → Boîte mail)");
  if (!cfg.smtpHost) throw badRequest("Serveur SMTP non renseigné");
  return nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpPort === 465, // 587 : STARTTLS obligatoire
    requireTLS: cfg.smtpPort !== 465,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 20000,
  });
}

// Erreurs SMTP lisibles
const explain = err => err?.code === "EAUTH"
  ? new Error("Identifiants refusés par le serveur SMTP : le mot de passe d'application est invalide ou a été révoqué")
  : err?.code === "ESOCKET" || err?.code === "ETIMEDOUT" || err?.code === "ECONNECTION"
    ? new Error("Le serveur SMTP ne répond pas (" + (err.message || err.code) + ")")
    : err;

const fromHeader = cfg => {
  const name = getSetting("me_nom", "").trim();
  return name ? { name, address: cfg.user } : cfg.user;
};

export async function testSmtp() {
  const cfg = getMailConfig();
  const t = transport(cfg);
  try {
    await t.verify().catch(e => { throw explain(e); });
    return { ok: true, server: `${cfg.smtpHost}:${cfg.smtpPort}` };
  } finally {
    t.close();
  }
}

// Mail de test envoyé à soi-même, pour vérifier le rendu avant une vraie campagne.
export async function sendTestToSelf({ subject, body, attachments = [] }) {
  const cfg = getMailConfig();
  const t = transport(cfg);
  try {
    const info = await t.sendMail({
      from: fromHeader(cfg),
      to: cfg.user,
      subject: `[TEST] ${subject || "(sans objet)"}`,
      text: body || "",
      attachments: loadAttachments(attachments),
    }).catch(e => { throw explain(e); });
    return { ok: true, messageId: info.messageId };
  } finally {
    t.close();
  }
}

function loadAttachments(ids) {
  const list = Array.isArray(ids) ? ids.map(Number).filter(Number.isInteger) : [];
  if (!list.length) return [];
  const docs = db.prepare(`SELECT id, name, type, hash FROM documents WHERE id IN (${list.map(() => "?").join(",")})`).all(...list);
  if (docs.length !== list.length) throw badRequest("Une pièce jointe n'existe plus dans le coffre");
  const missing = docs.find(d => !coffre.has(d.hash));
  if (missing) throw badRequest(`Le fichier de « ${missing.name} » manque dans db/coffre`);
  // Ordre des pièces jointes = ordre demandé (le CV en premier), pas celui renvoyé par SQLite.
  docs.sort((a, b) => list.indexOf(a.id) - list.indexOf(b.id));
  // nodemailer lit le fichier au moment de l'envoi : rien n'est chargé en mémoire d'avance
  return docs.map(d => ({ filename: d.name, path: coffre.path(d.hash), contentType: d.type || undefined }));
}

/* ---------- File d'envoi ---------- */

const OUTBOX_SELECT = `SELECT o.id, o.entreprise_id AS entrepriseId, e.nom AS entreprise, o.template_id AS templateId,
  o.to_email AS toEmail, o.subject, o.body, o.attachments, o.send_at AS sendAt, o.status, o.error,
  o.sent_at AS sentAt, o.created_at AS createdAt
  FROM outbox o LEFT JOIN entreprises e ON e.id = o.entreprise_id`;

const shape = r => ({ ...r, attachments: JSON.parse(r.attachments || "[]") });

export function listOutbox({ limit = 100 } = {}) {
  return db.prepare(`${OUTBOX_SELECT}
    ORDER BY CASE o.status WHEN 'pending' THEN 0 WHEN 'sending' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END,
             CASE WHEN o.status IN ('pending', 'sending') THEN o.send_at END ASC,
             o.send_at DESC
    LIMIT ?`).all(limit).map(shape);
}

// Met en file une campagne : un mail par entreprise (objet/corps déjà personnalisés par le front),
// le premier à `sendAt` (ou tout de suite), les suivants espacés de `spacingMinutes`.
export function enqueue({ items, sendAt, spacingMinutes = 0, attachments = [], templateId = null, allowPlaceholders = false }) {
  if (!Array.isArray(items) || !items.length) throw badRequest("Aucun destinataire");
  if (items.length > 200) throw badRequest("200 destinataires maximum par envoi");
  const cfg = getMailConfig();
  if (!isConfigured(cfg)) throw badRequest("Boîte mail non configurée (Réglages → Boîte mail)");

  const start = sendAt ? new Date(sendAt) : new Date();
  if (Number.isNaN(start.getTime())) throw badRequest("Date d'envoi invalide");
  if (start.getTime() > Date.now() + 90 * 86400000) throw badRequest("Date d'envoi trop lointaine (90 jours maximum)");
  const spacing = Number(spacingMinutes) || 0;
  if (spacing < 0 || spacing > 24 * 60) throw badRequest("Espacement invalide (0 à 1440 minutes)");
  // Un champ mal formé (pas un tableau) ne doit pas finir en erreur 500
  const attachIds = Array.isArray(attachments) ? attachments.map(Number).filter(Number.isInteger) : [];
  loadAttachments(attachIds); // vérifie que les documents existent

  const getEnt = db.prepare("SELECT id, email FROM entreprises WHERE id = ?");
  const ins = db.prepare(`INSERT INTO outbox (entreprise_id, template_id, to_email, subject, body, attachments, send_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const ids = transaction(() => items.map((it, i) => {
    const e = getEnt.get(Number(it.entrepriseId));
    if (!e) throw badRequest("Entreprise introuvable");
    if (!e.email) throw badRequest("Une entreprise sélectionnée n'a pas d'email");
    if (!String(it.subject ?? "").trim()) throw badRequest("Objet vide");
    const hole = !allowPlaceholders && findPlaceholder(`${it.subject}\n${it.body}`);
    if (hole) throw badRequest(`Texte à compléter dans le message : ${hole}`);
    const at = new Date(start.getTime() + i * spacing * 60000).toISOString();
    const info = ins.run(e.id, templateId ? Number(templateId) : null, e.email, String(it.subject), String(it.body ?? ""),
      JSON.stringify(attachIds), at);
    return Number(info.lastInsertRowid);
  }));
  emit("outbox");
  setTimeout(tick, 200); // un envoi « maintenant » part sans attendre le prochain tour
  return { ok: true, ids };
}

export function cancelOutbox(id) {
  const info = db.prepare("UPDATE outbox SET status = 'cancelled' WHERE id = ? AND status IN ('pending', 'failed')").run(id);
  if (!info.changes) throw badRequest("Cet envoi n'est plus annulable");
  emit("outbox");
}

export function retryOutbox(id) {
  const info = db.prepare("UPDATE outbox SET status = 'pending', error = '', send_at = ? WHERE id = ? AND status IN ('failed', 'cancelled')")
    .run(new Date().toISOString(), id);
  if (!info.changes) throw badRequest("Seul un envoi échoué ou annulé peut être relancé");
  emit("outbox");
  setTimeout(tick, 200);
}

let running = false;
let again = false; // un passage a été demandé pendant qu'un autre tournait

export async function tick() {
  if (running) { again = true; return; }
  running = true;
  again = false;
  let transporter = null;
  try {
    // Mails orphelins (entreprise supprimée) : on n'envoie pas.
    db.prepare("UPDATE outbox SET status = 'cancelled', error = 'Entreprise supprimée' WHERE status = 'pending' AND entreprise_id IS NULL").run();
    const due = db.prepare("SELECT * FROM outbox WHERE status = 'pending' AND send_at <= ? ORDER BY send_at, id LIMIT 20")
      .all(new Date().toISOString());
    if (!due.length) return;

    const cfg = getMailConfig();
    let sent = 0, failed = 0;
    for (const row of due) {
      db.prepare("UPDATE outbox SET status = 'sending' WHERE id = ?").run(row.id);
      try {
        transporter ??= transport(cfg);
        const info = await transporter.sendMail({
          from: fromHeader(cfg),
          to: row.to_email,
          subject: row.subject,
          text: row.body,
          attachments: loadAttachments(JSON.parse(row.attachments)),
        });
        transaction(() => {
          db.prepare("UPDATE outbox SET status = 'sent', error = '', sent_at = ?, message_id = ? WHERE id = ?")
            .run(new Date().toISOString(), info.messageId || null, row.id);
          // Même règle de statut que le mode brouillon (routes/entreprises.js)
          if (row.entreprise_id) {
            recordMailSent(row.entreprise_id, { moyen: "Mail (SMTP)", note: `Objet : ${row.subject}`, templateId: row.template_id });
          }
        });
        sent++;
      } catch (err) {
        db.prepare("UPDATE outbox SET status = 'failed', error = ? WHERE id = ?").run(String(explain(err).message).slice(0, 300), row.id);
        failed++;
      }
    }
    emit("outbox", { sent, failed });
    if (sent) emit("entreprises");
    if (failed) showToast("Envoi de mail échoué", `${failed} mail(s) non envoyé(s) — voir « Envois » dans l'app`);
  } catch (err) {
    console.error("File d'envoi :", err.message);
  } finally {
    transporter?.close();
    running = false;
    if (again) setTimeout(tick, 0);
  }
}

let timer = null;
export function startOutbox() {
  // Un envoi resté « sending » vient d'un arrêt brutal pendant l'envoi : état inconnu,
  // on le marque en échec plutôt que de risquer un doublon chez le recruteur.
  db.prepare("UPDATE outbox SET status = 'failed', error = 'Interrompu par l''arrêt du serveur — vérifie dans tes « Messages envoyés » avant de relancer' WHERE status = 'sending'").run();
  clearInterval(timer);
  timer = setInterval(tick, 30000);
  setTimeout(tick, 5000);
}

export function stopOutbox() {
  clearInterval(timer);
}
