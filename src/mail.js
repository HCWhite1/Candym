// Boîte mail : configuration (IMAP + SMTP, même compte) et surveillance IMAP qui
// détecte les réponses des entreprises suivies, met à jour leur statut et crée des notifications.
// Réglages dans la table settings (clés mail_* et smtp_*) ; mot de passe dans le
// Gestionnaire d'identifiants Windows (src/secrets.js).
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { db, getSetting, setSetting, deleteSetting, transaction } from "./db.js";
import { getMailPassword, setMailPassword, deleteMailPassword } from "./secrets.js";
import { matchEntreprise, analyze, isOutOfOffice } from "./mail/classify.js";
import { emit } from "./events.js";
import { showToast } from "./notify.js";

const CONFIG_KEYS = ["mail_host", "mail_port", "mail_user", "mail_poll_minutes", "mail_last_uid", "mail_uidvalidity", "smtp_host", "smtp_port"];

// Serveur SMTP déduit du serveur IMAP quand il n'est pas renseigné.
export function defaultSmtp(imapHost) {
  const h = String(imapHost || "").toLowerCase();
  if (h === "imap.gmail.com") return { host: "smtp.gmail.com", port: 465 };
  if (h.endsWith("office365.com") || h.includes("outlook")) return { host: "smtp-mail.outlook.com", port: 587 };
  return h ? { host: h.replace(/^imap\./, "smtp."), port: 465 } : { host: "", port: 465 };
}

export function getMailConfig() {
  const host = getSetting("mail_host", "");
  const smtpDefault = defaultSmtp(host);
  return {
    host,
    port: Number(getSetting("mail_port", 993)),
    user: getSetting("mail_user", ""),
    pass: getMailPassword(),
    pollMinutes: Number(getSetting("mail_poll_minutes", 5)),
    smtpHost: getSetting("smtp_host", "") || smtpDefault.host,
    smtpPort: Number(getSetting("smtp_port", 0)) || smtpDefault.port,
  };
}

export function isConfigured(c = getMailConfig()) {
  return Boolean(c.host && c.user && c.pass);
}

export function publicMailConfig() {
  const c = getMailConfig();
  return {
    host: c.host,
    port: c.port,
    user: c.user,
    pollMinutes: c.pollMinutes,
    smtpHost: c.smtpHost,
    smtpPort: c.smtpPort,
    hasPassword: Boolean(c.pass),
    configured: isConfigured(c),
  };
}

const badRequest = msg => Object.assign(new Error(msg), { status: 400 });
const cleanHost = v => {
  const h = String(v ?? "").trim().toLowerCase();
  if (h && !/^[a-z0-9.-]+$/.test(h)) throw badRequest("Nom de serveur invalide");
  return h;
};
const checkPort = v => {
  const p = Number(v);
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw badRequest("Port invalide");
  return p;
};

// Enregistre la configuration. Si un serveur (IMAP ou SMTP) ou l'adresse change
// sans que le mot de passe soit ressaisi, le mot de passe enregistré est effacé :
// on ne l'envoie jamais à un serveur autre que celui pour lequel il a été saisi.
export function saveMailConfig(b = {}) {
  const before = getMailConfig();
  const next = {
    host: b.host !== undefined ? cleanHost(b.host) : before.host,
    user: b.user !== undefined ? String(b.user).trim() : before.user,
    smtpHost: b.smtpHost !== undefined ? cleanHost(b.smtpHost) : getSetting("smtp_host", ""),
  };
  // Tout est validé avant la moindre écriture : une requête refusée ne laisse pas de config à moitié enregistrée
  const port = b.port !== undefined ? checkPort(b.port) : undefined;
  const smtpPort = b.smtpPort !== undefined ? checkPort(b.smtpPort) : undefined;
  let poll;
  if (b.pollMinutes !== undefined) {
    poll = Number(b.pollMinutes);
    if (!Number.isInteger(poll) || poll < 1 || poll > 120) throw badRequest("Fréquence invalide (1 à 120 minutes)");
  }
  if (port !== undefined) setSetting("mail_port", port);
  if (smtpPort !== undefined) setSetting("smtp_port", smtpPort);
  if (poll !== undefined) setSetting("mail_poll_minutes", poll);

  const effectiveSmtp = next.smtpHost || defaultSmtp(next.host).host;
  const target = [next.host, next.user, effectiveSmtp].join("|");
  const previous = [before.host, before.user, before.smtpHost].join("|");
  let passwordCleared = false;
  if (b.pass) {
    setMailPassword(b.pass);
  } else if (before.pass && target !== previous) {
    deleteMailPassword();
    passwordCleared = true;
  }

  setSetting("mail_host", next.host);
  setSetting("mail_user", next.user);
  setSetting("smtp_host", next.smtpHost);
  if (next.host !== before.host || next.user !== before.user) {
    // Autre boîte : on repart du début (7 derniers jours).
    deleteSetting("mail_last_uid");
    deleteSetting("mail_uidvalidity");
  }
  schedulePolling();
  return { ...publicMailConfig(), passwordCleared };
}

export function clearMailConfig() {
  for (const k of CONFIG_KEYS) deleteSetting(k);
  deleteMailPassword();
  stopPolling();
}

// Port 993 : TLS direct ; autre port (143) : STARTTLS obligatoire. Jamais en clair.
function openClient(cfg) {
  const port = cfg.port || 993;
  return new ImapFlow({
    host: cfg.host,
    port,
    secure: port === 993,
    doSTARTTLS: port === 993 ? undefined : true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });
}

// Vérifie que la connexion fonctionne ; renvoie le nombre de messages en boîte.
export async function testConnection() {
  const cfg = getMailConfig();
  if (!isConfigured(cfg)) throw new Error("Configuration incomplète : serveur, adresse et mot de passe sont requis");
  const client = await connect(cfg);
  try {
    const status = await client.status("INBOX", { messages: true });
    return { ok: true, messages: status.messages };
  } finally {
    await client.logout().catch(() => {});
  }
}

// Messages d'erreur IMAP lisibles (imapflow renvoie souvent « Command failed »).
export function explainImapError(err) {
  if (err?.authenticationFailed || /invalid credentials|authenticationfailed/i.test(err?.responseText || err?.message || "")) {
    return new Error("Identifiants refusés par le serveur : le mot de passe d'application est invalide ou a été révoqué. Crée-en un nouveau et enregistre-le dans les réglages.");
  }
  if (err?.code === "ENOTFOUND") return new Error("Serveur mail introuvable (nom incorrect ou pas de connexion Internet)");
  if (err?.code === "ETIMEDOUT" || err?.code === "ECONNREFUSED") return new Error("Le serveur mail ne répond pas");
  return new Error(err?.responseText || err?.message || "Erreur IMAP");
}

async function connect(cfg) {
  const client = openClient(cfg);
  try {
    await client.connect();
  } catch (err) {
    client.close(); // sans cela, le socket d'une connexion refusée reste ouvert
    throw explainImapError(err);
  }
  return client;
}

const loadEntreprises = () => db.prepare("SELECT id, nom, email, statut FROM entreprises WHERE email != ''").all();

// Traite un message déjà décomposé (sans IMAP ; utilisé par les tests).
// Écrit en base : historique "reponse", éventuel changement de statut, notification.
export function processParsedMessage({ fromAddr, subject = "", text = "", date, messageId = "" }, entreprises = loadEntreprises()) {
  if (messageId) {
    const dup = db.prepare("SELECT id FROM notifications WHERE message_id = ?").get(messageId);
    if (dup) return { matched: false, reason: "doublon" };
  }
  // L'utilisateur qui s'écrit à lui-même (copie d'un envoi) n'est pas une réponse
  const cfg = getMailConfig();
  if (cfg.user && String(fromAddr).toLowerCase().trim() === cfg.user.toLowerCase()) {
    return { matched: false, reason: "expéditeur = soi-même" };
  }
  const e = matchEntreprise(fromAddr, entreprises);
  if (!e) return { matched: false, reason: "expéditeur inconnu" };
  if (isOutOfOffice(subject)) return { matched: false, reason: "message d'absence" };

  const { classement, strong, weak, text: ownText } = analyze(subject, text);
  const now = new Date().toISOString();
  const mailDate = date ? new Date(date).toISOString() : now;
  const snippet = ownText.replace(/\s+/g, " ").trim().slice(0, 180);

  transaction(() => {
    db.prepare("INSERT INTO historique (entreprise_id, date, type, moyen, note) VALUES (?, ?, 'reponse', 'Email', ?)")
      .run(e.id, mailDate, subject ? `Objet : ${subject}` : "Réponse par email");
    if (classement) {
      db.prepare("UPDATE entreprises SET statut = ?, reponse = 1 WHERE id = ?").run(classement, e.id);
    }
    db.prepare(`INSERT INTO notifications (entreprise_id, classement, auto, from_email, subject, snippet, mail_date, message_id, motifs, created_at)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`)
      .run(e.id, classement, String(fromAddr), String(subject), snippet, mailDate, messageId || null, JSON.stringify({ strong, weak }), now);
  });

  return { matched: true, entrepriseId: e.id, nom: e.nom, classement };
}

let checking = false;

// Relève la boîte : messages plus récents que le dernier UID traité
// (au premier passage : les 7 derniers jours). On lit d'abord les seules enveloppes,
// puis on ne télécharge que les mails dont l'expéditeur correspond à une entreprise suivie.
export async function checkMail() {
  if (checking) return { skipped: true };
  const cfg = getMailConfig();
  if (!isConfigured(cfg)) throw new Error("Boîte mail non configurée (voir Réglages)");
  checking = true;
  try {
    const client = await connect(cfg);
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uidValidity = Number(client.mailbox.uidValidity);
      let lastUid = Number(getSetting("mail_last_uid", 0));
      if (Number(getSetting("mail_uidvalidity", 0)) !== uidValidity) lastUid = 0; // renumérotation serveur
      const range = lastUid
        ? { uid: `${lastUid + 1}:*` }
        : { since: new Date(Date.now() - 7 * 86400000) };

      const entreprises = loadEntreprises();
      const candidates = [];
      let scanned = 0;
      // Pas d'autre commande IMAP pendant l'itération (imapflow) : on collecte d'abord.
      for await (const msg of client.fetch(range, { uid: true, envelope: true }, { uid: true })) {
        if (msg.uid <= lastUid) continue; // "n:*" renvoie le dernier message même s'il est < n
        scanned++;
        const from = msg.envelope?.from?.[0]?.address || "";
        if (matchEntreprise(from, entreprises)) candidates.push(msg.uid);
      }

      const details = [];
      for (const uid of candidates) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg?.source) continue;
        const parsed = await simpleParser(msg.source);
        const res = processParsedMessage({
          fromAddr: parsed.from?.value?.[0]?.address || "",
          subject: parsed.subject || "",
          text: parsed.text || "",
          date: parsed.date,
          messageId: parsed.messageId || "",
        }, entreprises);
        if (res.matched) details.push(res);
      }

      const maxUid = Math.max(lastUid, Number(client.mailbox.uidNext) - 1);
      setSetting("mail_uidvalidity", uidValidity);
      setSetting("mail_last_uid", maxUid);

      if (details.length) {
        emit("notifications", { count: details.length });
        const names = details.map(d => d.nom).join(", ");
        showToast(details.length > 1 ? `${details.length} réponses d'entreprises` : "Réponse d'une entreprise", names);
      }
      return { scanned, matched: details.length, details };
    } finally {
      lock.release();
      await client.logout().catch(() => {});
    }
  } finally {
    checking = false;
  }
}

/* ---------- Relève périodique ---------- */
let timer = null;
let firstCheck = null;

export function stopPolling() {
  clearInterval(timer);
  clearTimeout(firstCheck);
  timer = firstCheck = null;
}

export function schedulePolling() {
  stopPolling();
  if (!isConfigured()) return;
  const mins = Math.min(120, Math.max(1, getMailConfig().pollMinutes || 5));
  const run = () => checkMail()
    .then(r => { if (r.matched) console.log(`Mail : ${r.matched} réponse(s) d'entreprise détectée(s)`); })
    .catch(err => console.error("Relève mail impossible :", err.message));
  timer = setInterval(run, mins * 60000);
  // Première relève peu après le démarrage, sans bloquer le serveur
  firstCheck = setTimeout(run, 10000);
}
