// Réglages : relances, envoi des mails, identité, notifications, boîte mail (IMAP/SMTP),
// jeton La bonne alternance,
// export JSON/CSV, import, réinitialisation depuis le fichier d'origine.
import { STATUTS } from "../constants.js";
import { api } from "../api.js";
import { state, selection, loadAll, lastContact } from "../state.js";
import { $, toast, download, csvCell } from "../utils.js";
import { renderAll } from "./render.js";
import { showModal, closeModals } from "./modals.js";
import { refreshNotifications } from "./notifications.js";

const MAIL_PRESETS = {
  gmail: { host: "imap.gmail.com", port: 993, smtpHost: "smtp.gmail.com", smtpPort: 465 },
  outlook: { host: "outlook.office365.com", port: 993, smtpHost: "smtp-mail.outlook.com", smtpPort: 587 },
};

const status = msg => { $("#mailStatus").textContent = msg; };

function sendModeHint() {
  const smtp = $("#s_mailopen").value === "smtp";
  const el = $("#sendModeHint");
  el.textContent = smtp && !state.mail.configured
    ? "Configure d'abord la boîte mail ci-dessous pour activer l'envoi direct."
    : "";
  el.hidden = !el.textContent;
  el.classList.toggle("warn", smtp && !state.mail.configured);
}

function setBadge(id, ok, onLabel, offLabel) {
  const el = $(id);
  if (!el) return;
  el.textContent = ok ? onLabel : offLabel;
  el.classList.toggle("ok", !!ok);
}

async function fillMailForm() {
  try {
    const c = await api.mail.getConfig();
    // Le fournisseur affiché suit le serveur enregistré (il restait sur « — choisir — »)
    const preset = Object.entries(MAIL_PRESETS).find(([, p]) => p.host === c.host)?.[0];
    $("#s_mail_preset").value = preset || (c.host ? "custom" : "");
    $("#s_mail_host").value = c.host || "";
    $("#s_mail_port").value = c.port || 993;
    $("#s_smtp_host").value = c.smtpHost || "";
    $("#s_smtp_port").value = c.smtpPort || 465;
    $("#s_mail_user").value = c.user || "";
    $("#s_mail_pass").value = "";
    $("#s_mail_pass").placeholder = c.hasPassword ? "•••••• (laisser vide pour conserver)" : "";
    $("#s_mail_poll").value = c.pollMinutes || 5;
    $("#bClearMail").hidden = !c.configured;
    setBadge("#mailBadge", c.configured, "Configurée", "Non configurée");
    status(c.configured ? "Boîte configurée — relève automatique active." : c.host ? "Mot de passe d'application manquant." : "");
    state.mail = { user: c.user || "", configured: !!c.configured };
    sendModeHint();
  } catch { /* le serveur répondra au prochain essai */ }
}

async function runTest(label, fn, ok) {
  status(`${label} en cours…`);
  try {
    const r = await fn();
    status(ok(r));
    toast(ok(r));
  } catch (err) {
    status(err.message);
    toast(err.message, "err");
  }
}

function initMailSettings() {
  $("#s_mail_preset").addEventListener("change", ev => {
    const p = MAIL_PRESETS[ev.target.value];
    if (!p) return;
    $("#s_mail_host").value = p.host;
    $("#s_mail_port").value = p.port;
    $("#s_smtp_host").value = p.smtpHost;
    $("#s_smtp_port").value = p.smtpPort;
  });

  $("#bSaveMail").addEventListener("click", async () => {
    try {
      const c = await api.mail.saveConfig({
        host: $("#s_mail_host").value.trim(),
        port: Number($("#s_mail_port").value) || 993,
        smtpHost: $("#s_smtp_host").value.trim(),
        smtpPort: Number($("#s_smtp_port").value) || 465,
        user: $("#s_mail_user").value.trim(),
        pass: $("#s_mail_pass").value, // vide = mot de passe existant conservé (si serveurs et adresse inchangés)
        pollMinutes: Number($("#s_mail_poll").value) || 5,
      });
      $("#s_mail_pass").value = "";
      $("#s_mail_pass").placeholder = c.hasPassword ? "•••••• (laisser vide pour conserver)" : "";
      $("#bClearMail").hidden = !c.configured;
      setBadge("#mailBadge", c.configured, "Configurée", "Non configurée");
      state.mail = { user: c.user || "", configured: !!c.configured };
      sendModeHint();
      if (c.passwordCleared) {
        status("Serveur ou adresse modifié : par sécurité, le mot de passe enregistré a été effacé. Saisis-le à nouveau.");
        toast("Mot de passe à ressaisir", "warn");
        $("#s_mail_pass").focus();
        return;
      }
      status(c.configured
        ? "Configuration enregistrée — teste la connexion pour vérifier."
        : "Configuration incomplète : serveur, adresse et mot de passe sont requis.");
      toast("Configuration mail enregistrée");
    } catch (err) { toast(err.message, "err"); }
  });

  $("#bTestMail").addEventListener("click", () => runTest("Connexion IMAP", api.mail.test,
    r => `Réception OK — ${r.messages} message(s) dans la boîte de réception.`));
  $("#bTestSmtp").addEventListener("click", () => runTest("Connexion SMTP", api.mail.testSmtp,
    r => `Envoi OK — serveur ${r.server} prêt.`));

  $("#bCheckMail").addEventListener("click", async () => {
    status("Relève en cours…");
    try {
      const r = await api.mail.check();
      if (r.skipped) { status("Une relève est déjà en cours."); return; }
      status(`${r.scanned ?? 0} nouveau(x) message(s) analysé(s), ${r.matched ?? 0} réponse(s) d'entreprise détectée(s).`);
      await refreshNotifications();
      await loadAll();
      renderAll();
      toast(r.matched ? `${r.matched} réponse(s) détectée(s) — regarde la cloche` : "Aucune nouvelle réponse d'entreprise");
    } catch (err) {
      status(err.message);
      toast(err.message, "err");
    }
  });

  $("#bClearMail").addEventListener("click", async () => {
    if (!confirm("Effacer la configuration mail (serveurs, adresse, mot de passe) ?")) return;
    try {
      await api.mail.clearConfig();
      fillMailForm();
      toast("Boîte mail déconnectée");
    } catch (err) { toast(err.message, "err"); }
  });
}

/* ---------- La bonne alternance ---------- */
const lbaStatus = msg => { $("#lbaStatus").textContent = msg; };

export async function fillLbaForm() {
  $("#s_lba_token").value = "";
  try {
    const { configured } = await api.lba.status();
    $("#s_lba_token").placeholder = configured ? "•••••• (jeton enregistré)" : "";
    $("#bClearLba").hidden = !configured;
    setBadge("#lbaBadge", configured, "Actif", "Non configuré");
    lbaStatus(configured ? "Jeton enregistré." : "");
    return configured;
  } catch { return false; }
}

function initLbaSettings() {
  $("#bSaveLba").addEventListener("click", async () => {
    const token = $("#s_lba_token").value.trim();
    if (!token) { toast("Colle d'abord le jeton", "warn"); return; }
    lbaStatus("Vérification auprès de La bonne alternance…");
    try {
      await api.lba.saveToken(token);
      await fillLbaForm();
      lbaStatus("Jeton vérifié et enregistré dans le Gestionnaire d'identifiants Windows.");
      toast("Jeton La bonne alternance enregistré");
    } catch (err) {
      lbaStatus(err.message);
      toast(err.message, "err");
    }
  });
  $("#bClearLba").addEventListener("click", async () => {
    if (!confirm("Supprimer le jeton La bonne alternance de ce PC ?")) return;
    try {
      await api.lba.deleteToken();
      await fillLbaForm();
      toast("Jeton supprimé");
    } catch (err) { toast(err.message, "err"); }
  });
}

async function saveSetting(patch, message) {
  try {
    const s = await api.settings.update(patch);
    Object.assign(state.settings, s);
    renderAll();
    if (message) toast(message(s));
  } catch (err) { toast(err.message, "err"); }
}

export function initSettings() {
  $("#btnSettings").addEventListener("click", () => {
    $("#s_delai").value = state.settings.delaiRelance;
    $("#s_mailopen").value = state.settings.mailOpenMode || "gmail";
    $("#s_me_nom").value = state.settings.meNom || "";
    $("#s_me_tel").value = state.settings.meTel || "";
    $("#s_notif").checked = !!state.settings.notifWindows;
    sendModeHint();
    fillMailForm();
    fillLbaForm();
    showModal("#mSettings");
  });
  initMailSettings();
  initLbaSettings();

  $("#s_mailopen").addEventListener("change", ev => {
    sendModeHint();
    saveSetting({ mailOpenMode: ev.target.value }, () => `Mode d'envoi : ${$("#s_mailopen").selectedOptions[0].textContent}`);
  });

  $("#s_delai").addEventListener("change", () => {
    const v = parseInt($("#s_delai").value, 10);
    if (!(v >= 1 && v <= 60)) { toast("Délai entre 1 et 60 jours", "err"); return; }
    saveSetting({ delaiRelance: v }, s => `Délai de relance : ${s.delaiRelance} j`);
  });

  $("#s_me_nom").addEventListener("change", ev => saveSetting({ meNom: ev.target.value }, () => "Nom enregistré"));
  $("#s_me_tel").addEventListener("change", ev => saveSetting({ meTel: ev.target.value }, () => "Téléphone enregistré"));
  $("#s_notif").addEventListener("change", ev => saveSetting({ notifWindows: ev.target.checked },
    s => s.notifWindows ? "Notifications Windows activées" : "Notifications Windows désactivées"));
  $("#bTestNotif").addEventListener("click", async () => {
    try {
      await api.settings.testNotification();
      toast("Notification envoyée — regarde en bas à droite de l'écran");
    } catch (err) { toast(err.message, "err"); }
  });

  $("#btnExportJson").addEventListener("click", () => {
    download("candym-" + new Date().toISOString().slice(0, 10) + ".json",
      JSON.stringify({ entreprises: state.entreprises, templates: state.templates, settings: state.settings, exportedAt: new Date().toISOString() }, null, 1),
      "application/json");
    toast("Sauvegarde JSON exportée");
  });

  $("#btnExportCsv").addEventListener("click", () => {
    const cols = ["nom", "statut", "pertinence", "activite", "ville", "cp", "adresse", "email", "tel", "url", "interlocuteur", "entretien", "dernier_contact", "note"];
    const lines = [cols.join(";")];
    for (const e of state.entreprises) {
      const lc = lastContact(e);
      lines.push([e.nom, STATUTS[e.statut].label, e.pertinence, e.activite, e.ville, e.cp, e.adresse, e.email, e.tel, e.url,
        [e.contactNom, e.contactPoste].filter(Boolean).join(" — "), e.dateEntretien.replace("T", " "),
        lc ? lc.toISOString().slice(0, 10) : "", e.note.replaceAll("\n", " | ")].map(csvCell).join(";"));
    }
    download("candym-" + new Date().toISOString().slice(0, 10) + ".csv", "\uFEFF" + lines.join("\r\n"), "text/csv;charset=utf-8");
    toast("Export CSV prêt");
  });

  $("#importInput").addEventListener("change", ev => {
    const f = ev.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async () => {
      let data;
      try {
        data = JSON.parse(r.result);
        if (!Array.isArray(data.entreprises)) throw new Error("format");
      } catch {
        toast("Fichier invalide — attendu : un export JSON de cette app", "err");
        return;
      }
      if (!confirm(`Importer ${data.entreprises.length} entreprises ? Cela remplace les données actuelles (une sauvegarde est faite avant).`)) return;
      try {
        await api.data.importJson(data);
        await loadAll();
        selection.clear();
        closeModals();
        renderAll();
        toast("Import réussi ✓");
      } catch (err) { toast(err.message, "err"); }
    };
    r.readAsText(f);
    ev.target.value = "";
  });

  $("#btnReset").addEventListener("click", async () => {
    let info;
    try { info = await api.data.resetInfo(); } catch (err) { toast(err.message, "err"); return; }
    const pending = info.envoisProgrammes ? `\n• ${info.envoisProgrammes} envoi(s) programmé(s) seront annulés` : "";
    if (!confirm(
      `Réinitialiser la liste d'entreprises ?\n\n`
      + `• Tes ${info.entreprises} entreprises et leurs ${info.historique} événements d'historique seront SUPPRIMÉS\n`
      + `• La liste repartira de zéro (${info.seedEntreprises} entreprise(s) initiale(s))${pending}\n`
      + `• Conservés : modèles, réglages, coffre, notifications\n`
      + `• Une sauvegarde complète est faite avant (dossier db/backups)`)) return;
    const typed = (prompt("Pour confirmer, tape REINITIALISER") || "").normalize("NFD").replace(/\p{M}/gu, "").trim().toUpperCase();
    if (typed !== "REINITIALISER") { toast("Réinitialisation annulée", "warn"); return; }
    try {
      await api.data.reset();
      await loadAll();
      selection.clear();
      closeModals();
      renderAll();
      toast("Données réinitialisées — sauvegarde dans db/backups");
    } catch (err) { toast(err.message, "err"); }
  });
}
