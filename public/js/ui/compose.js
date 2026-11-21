// Écran « Contacter par email ». Deux familles de modes (Réglages → Envoi des mails) :
// - brouillon (Gmail, Outlook.com, mailto:) : l'app pré-remplit, tu envoies toi-même,
//   puis tu confirmes « Envoyé » pour que le contact soit tracé ;
// - SMTP : l'app envoie elle-même, tout de suite ou à l'heure programmée, pièces jointes comprises ;
//   le contact est tracé automatiquement une fois le mail accepté par le serveur.
import { api } from "../api.js";
import { SEND_MODES, TEMPLATE_KINDS } from "../constants.js";
import { state, byId, selection, isRelanceFor, markContacted, me, isSmtpMode } from "../state.js";
import { $, html, toast, busy, applyVars, missingIdentity, findPlaceholder, toLocalInput, fmtDateTime } from "../utils.js";
import { icon } from "../icons.js";
import { renderAll } from "./render.js";
import { showModal, closeModals } from "./modals.js";
import { docRowHtml, openVault } from "./vault.js";
import { openTplManager } from "./templates.js";
import { openOutbox } from "./outbox.js";

let compose = null;

const modeInfo = () => SEND_MODES[state.settings.mailOpenMode] || SEND_MODES.gmail;

function openMailWindow({ to = "", bcc = "", subject = "", body = "" }) {
  const enc = encodeURIComponent;
  const mode = state.settings.mailOpenMode || "gmail";
  if (mode === "gmail") {
    // authuser force le compte configuré dans Réglages → Boîte mail (sinon Gmail ouvre /u/0)
    const authuser = state.mail.user ? "&authuser=" + enc(state.mail.user) : "";
    window.open(`https://mail.google.com/mail/?view=cm&fs=1${authuser}&to=${enc(to)}${bcc ? "&bcc=" + enc(bcc) : ""}&su=${enc(subject)}&body=${enc(body)}`, "_blank", "noopener");
  } else if (mode === "outlook") {
    window.open(`https://outlook.live.com/mail/deeplink/compose?to=${enc(to)}${bcc ? "&bcc=" + enc(bcc) : ""}&subject=${enc(subject)}&body=${enc(body)}`, "_blank", "noopener");
  } else {
    location.href = `mailto:${enc(to)}?${bcc ? "bcc=" + enc(bcc) + "&" : ""}subject=${enc(subject)}&body=${enc(body)}`;
  }
}

// Prochain jour ouvré à 9 h (ou aujourd'hui 9 h s'il n'est pas encore 9 h)
function defaultSendAt() {
  const d = new Date();
  if (d.getHours() >= 9) d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

export function openCompose(ids, presetTplId) {
  const all = ids.map(byId).filter(Boolean);
  const ok = all.filter(e => e.email);
  const noMail = all.filter(e => !e.email);
  if (!ok.length) { toast("Aucune des entreprises sélectionnées n'a d'email", "err"); return; }

  const smtp = isSmtpMode();
  const preset = state.templates.find(t => t.id === presetTplId);
  // applied : dernier texte posé par un modèle, pour savoir si le message a été retouché depuis
  compose = { targets: ok, idx: 0, smtp, tplValue: preset ? String(preset.id) : "", applied: { subject: preset?.subject || "", body: preset?.body || "" } };
  const multi = ok.length > 1;

  $("#composeTitle").textContent = smtp ? "Envoyer par email" : "Contacter par email";
  $("#composeBody").innerHTML = html`
    <div class="field"><span class="flabel">Destinataires (<span id="cCount">${ok.length}</span>)</span>
      <div class="chips" id="cChips"></div>
      ${noMail.length > 0 && html`<p class="hint warn">Sans email connu, donc exclues : ${noMail.map(e => e.nom).join(", ")}. Ajoute leur adresse via « Modifier ».</p>`}
    </div>
    <div class="field"><label for="cTpl">Modèle</label>
      <div class="inline">
        <select id="cTpl" class="grow">
          <option value="">— aucun (message libre) —</option>
          ${state.templates.map(t => html`<option value="${t.id}" ${t.id === presetTplId ? "selected" : ""}>${t.name} · ${TEMPLATE_KINDS[t.kind] || "Autre"}</option>`)}
        </select>
        <button class="btn" id="cTplManage" title="Créer ou modifier les modèles (ferme ce message)">Gérer</button>
      </div>
    </div>
    <div class="field"><label for="cSubject">Objet</label><input id="cSubject" value="${preset?.subject || ""}"></div>
    <div class="field"><label for="cBody">Corps du message</label><textarea id="cBody" rows="10">${preset?.body || ""}</textarea>
      <p class="hint">Variables : <code>{entreprise}</code> <code>{ville}</code> <code>{activite}</code> <code>{interlocuteur}</code> <code>{moi.nom}</code> <code>{moi.tel}</code> <code>{moi.email}</code> — remplacées pour chaque destinataire.</p>
      <p class="hint warn mt-s" id="cInterloc" hidden></p>
    </div>
    ${multi && !smtp && html`
    <div class="radiorow">
      <label><input type="radio" name="cMode" value="individuel" checked><span>Un mail personnalisé par entreprise <small>Recommandé : chaque destinataire reçoit son propre mail, les variables sont remplacées, chaque envoi est tracé individuellement.</small></span></label>
      <label><input type="radio" name="cMode" value="groupe"><span>Un seul mail groupé (tous en Cci)<small>Plus rapide, mais impersonnel — les variables ne peuvent pas être remplacées. Les recruteurs repèrent vite les envois en masse.</small></span></label>
    </div>`}
    ${smtp ? html`
    <div class="dsection">
      <h3>Pièces jointes</h3>
      <div class="doclist" id="cDocs"><p class="hint">Chargement du coffre…</p></div>
    </div>
    <div class="dsection">
      <h3>Quand ?</h3>
      <div class="radiorow compact">
        <label><input type="radio" name="cWhen" value="now" checked><span>Maintenant</span></label>
        <label><input type="radio" name="cWhen" value="later"><span>Programmer l'envoi</span></label>
      </div>
      <div class="grid2">
        <div class="field" id="cSendAtField" hidden><label for="cSendAt">${multi ? "Date et heure du premier envoi" : "Date et heure d'envoi"}</label><input id="cSendAt" type="datetime-local" value="${toLocalInput(defaultSendAt())}"></div>
        ${multi && html`<div class="field"><label for="cSpacing">Minutes entre deux envois</label><input id="cSpacing" type="number" min="0" max="1440" value="4"></div>`}
      </div>
      ${state.mail.configured
        ? html`<p class="hint">Les mails partent depuis ton adresse ${state.mail.user} et apparaissent dans tes « Messages envoyés ».<span id="cLaterHint" hidden> L'app doit être ouverte (serveur lancé) à l'heure prévue ; sinon, l'envoi part à son prochain démarrage.</span></p>`
        : html`<p class="hint warn">Boîte mail non configurée : l'envoi direct ne peut pas partir. Renseigne-la dans Réglages → Boîte mail, ou choisis un mode « brouillon ».</p>`}
    </div>` : html`
    <div class="dsection">
      <h3>Pièces jointes</h3>
      <p class="hint warn">Un brouillon ${modeInfo().label.toLowerCase().includes("gmail") ? "Gmail" : "pré-rempli"} ne peut pas recevoir de fichier automatiquement. Télécharge ton document ici puis glisse-le dans le mail qui s'ouvrira — ou passe en envoi direct (SMTP) dans les réglages.</p>
      <div class="doclist" id="cDocs"><p class="hint">Chargement du coffre…</p></div>
    </div>`}`;

  renderComposeChips();
  api.documents.list().then(docs => {
    if (!$("#cDocs")) return; // la modale a changé d'écran entre-temps
    $("#cDocs").innerHTML = !docs.length
      ? html`<p class="hint">Coffre vide. <button class="btn small" id="cOpenVault">Ouvrir le coffre</button> pour y déposer ton CV.</p>`
      : smtp
        ? html`${docs.map(d => html`<label class="docrow selectable"><input type="checkbox" class="cAttach" value="${d.id}" ${/(^|[^a-z])cv([^a-z]|$)/i.test(d.name) ? "checked" : ""}>${docRowHtml(d, "inline")}</label>`)}`
        : html`${docs.map(d => docRowHtml(d, "download"))}`;
    $("#cOpenVault")?.addEventListener("click", () => { closeModals(); openVault(); });
  }).catch(() => { if ($("#cDocs")) $("#cDocs").innerHTML = html`<p class="hint">Coffre inaccessible.</p>`; });

  $("#cTpl").addEventListener("change", ev => {
    const t = state.templates.find(x => String(x.id) === ev.target.value);
    if (t) {
      // Un message retouché à la main n'est pas écrasé sans prévenir
      const subject = $("#cSubject").value, body = $("#cBody").value;
      const edited = (subject || body) && (subject !== compose.applied.subject || body !== compose.applied.body);
      if (edited && !confirm(`Remplacer le message en cours par le modèle « ${t.name} » ?`)) {
        ev.target.value = compose.tplValue;
        return;
      }
      $("#cSubject").value = t.subject;
      $("#cBody").value = t.body;
      compose.applied = { subject: t.subject, body: t.body };
    }
    compose.tplValue = ev.target.value;
    renderInterlocHint();
  });
  $("#cSubject").addEventListener("input", renderInterlocHint);
  $("#cBody").addEventListener("input", renderInterlocHint);
  renderInterlocHint();
  $("#cTplManage").addEventListener("click", () => {
    if (($("#cSubject").value || $("#cBody").value) && !confirm("Ouvrir les modèles ferme ce message : le texte en cours sera perdu. Continuer ?")) return;
    closeModals();
    openTplManager();
  });
  document.querySelectorAll('input[name="cWhen"]').forEach(r => r.addEventListener("change", syncWhen));
  renderComposeFoot();
  showModal("#mCompose");
  $("#cTpl").focus();
}

const isLater = () => document.querySelector('input[name="cWhen"]:checked')?.value === "later";

// Mode SMTP : la date n'apparaît que pour un envoi programmé, et le bouton dit ce qu'il va faire
function syncWhen() {
  const later = isLater();
  if ($("#cSendAtField")) $("#cSendAtField").hidden = !later;
  if ($("#cLaterHint")) $("#cLaterHint").hidden = !later;
  const n = compose.targets.length;
  if ($("#cGoLabel")) $("#cGoLabel").textContent = `${later ? "Programmer" : "Envoyer"}${n > 1 ? ` (${n})` : ""}`;
}

function renderComposeChips() {
  $("#cCount").textContent = compose.targets.length;
  $("#cChips").innerHTML = html`${compose.targets.map(e => html`
    <span class="chip" title="${e.email}">${e.nom}<button data-rm="${e.id}" title="Retirer ${e.nom}" aria-label="Retirer ${e.nom}">${icon("x", 12)}</button></span>`)}`;
  $("#cChips").querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => {
    compose.targets = compose.targets.filter(e => e.id !== Number(b.dataset.rm));
    if (!compose.targets.length) { closeModals(); return; }
    renderComposeChips();
    renderComposeFoot();
    renderInterlocHint();
  }));
}

// {interlocuteur} sans nom renseigné retombe sur « Madame, Monsieur » : on le signale sans bloquer
// (même idée que missingIdentity pour les variables {moi.*}), pour inciter à compléter la fiche.
function renderInterlocHint() {
  const el = $("#cInterloc");
  if (!el) return;
  const uses = `${$("#cSubject").value}\n${$("#cBody").value}`.includes("{interlocuteur}");
  const sans = uses ? compose.targets.filter(e => !e.contactNom) : [];
  el.hidden = !sans.length;
  if (!sans.length) return;
  const noms = sans.slice(0, 3).map(e => e.nom).join(", ") + (sans.length > 3 ? ` et ${sans.length - 3} autre(s)` : "");
  el.innerHTML = html`<code>{interlocuteur}</code> sans nom renseigné pour ${noms} : le mail dira « Madame, Monsieur ».
    Un nom (fiche → Modifier → Interlocuteur) rend la candidature plus personnelle.`;
}

function renderComposeFoot() {
  const n = compose.targets.length;
  const ready = state.mail.configured;
  $("#composeFoot").innerHTML = compose.smtp
    ? html`<button class="btn" data-close>Annuler</button>
      <button class="btn" id="cTest" ${ready ? "" : "disabled"}>${icon("mail", 14)} M'envoyer un test</button>
      <button class="btn primary" id="cGo" ${ready ? "" : "disabled"}>${icon("send", 14)} <span id="cGoLabel"></span></button>`
    : html`<button class="btn" data-close>Annuler</button>
      <button class="btn primary" id="cGo">${n > 1 ? `Lancer les envois (${n})` : modeInfo().button}</button>`;
  if (compose.smtp) {
    syncWhen();
    $("#cTest").addEventListener("click", sendTest);
    $("#cGo").addEventListener("click", sendSmtp);
  } else {
    $("#cGo").addEventListener("click", startDraftFlow);
  }
}

const templateId = () => Number($("#cTpl")?.value) || null;

// Vérifications communes avant tout envoi. Renvoie false si l'utilisateur annule.
function preflight(subject, body) {
  if (!subject.trim() && !confirm("Objet vide — continuer quand même ?")) return false;
  const missing = missingIdentity(subject + body, me());
  if (missing.length) {
    toast(`Renseigne ${missing.join(", ")} dans Réglages → Identité (utilisé par le modèle)`, "err");
    return false;
  }
  return true;
}

// Trous « [à compléter] » : le serveur les refuse, sauf confirmation explicite
function placeholderCheck(texts) {
  const hole = texts.map(findPlaceholder).find(Boolean);
  if (!hole) return { ok: true, allow: false };
  const go = confirm(`Le message contient encore « ${hole} ».\n\nEnvoyer quand même sans le compléter ?`);
  return { ok: go, allow: go };
}

/* ---------- Mode SMTP ---------- */

function smtpPayload() {
  const subject = $("#cSubject").value, body = $("#cBody").value;
  if (!preflight(subject, body)) return null;
  const items = compose.targets.map(e => ({
    entrepriseId: e.id,
    subject: applyVars(subject, e, me()),
    body: applyVars(body, e, me()),
  }));
  const hole = placeholderCheck(items.flatMap(i => [i.subject, i.body]));
  if (!hole.ok) return null;
  const attachments = [...document.querySelectorAll(".cAttach:checked")].map(c => Number(c.value));
  if (!attachments.length && /pi[eè]ces? jointes?|ci-joint/i.test(body)
      && !confirm("Le message mentionne une pièce jointe, mais aucun document n'est coché. Envoyer quand même ?")) return null;
  const later = isLater();
  let sendAt;
  if (later) {
    const d = new Date($("#cSendAt").value);
    if (Number.isNaN(d.getTime())) { toast("Choisis une date d'envoi", "err"); return null; }
    if (d.getTime() < Date.now() - 60000) { toast("La date d'envoi est déjà passée", "err"); return null; }
    sendAt = d.toISOString();
  }
  return {
    items,
    sendAt,
    spacingMinutes: items.length > 1 ? Number($("#cSpacing")?.value) || 0 : 0,
    attachments,
    templateId: templateId(),
    allowPlaceholders: hole.allow,
  };
}

async function sendTest() {
  const e = compose.targets[0];
  const subject = $("#cSubject").value, body = $("#cBody").value;
  if (!preflight(subject, body)) return;
  await busy($("#cTest"), async () => {
    await api.outbox.testToSelf({
      subject: applyVars(subject, e, me()),
      body: applyVars(body, e, me()),
      attachments: [...document.querySelectorAll(".cAttach:checked")].map(c => Number(c.value)),
    });
    toast(`Test envoyé à ${state.mail.user} (personnalisé pour ${e.nom})`);
  });
}

async function sendSmtp() {
  const p = smtpPayload();
  if (!p) return;
  const n = p.items.length;
  const later = !!p.sendAt;
  const plural = n > 1 ? "s" : "";
  const when = later ? `à partir du ${fmtDateTime(p.sendAt)}` : "maintenant";
  if (n > 1 && !confirm(`Envoyer ${n} mails ${when}${p.spacingMinutes ? `, un toutes les ${p.spacingMinutes} min` : ""} ?`)) return;
  await busy($("#cGo"), async () => {
    await api.outbox.enqueue(p);
    selection.clear();
    closeModals();
    renderAll();
    toast(later ? `${n} envoi${plural} programmé${plural} — suivi dans « Envois »` : `${n} mail${plural} en cours d'envoi — suivi dans « Envois »`);
    if (n > 1 || later) openOutbox();
  });
}

/* ---------- Mode brouillon (Gmail, Outlook, mailto) ---------- */

function startDraftFlow() {
  const subject = $("#cSubject").value, body = $("#cBody").value;
  if (!preflight(subject, body)) return;
  const mode = document.querySelector('input[name="cMode"]:checked')?.value || "individuel";
  const hole = placeholderCheck([subject, body].map(t => applyVars(t, compose.targets[0], me())));
  if (!hole.ok) return;
  Object.assign(compose, { subject, body, mode, templateId: templateId() });

  if (mode === "groupe") {
    const bcc = compose.targets.map(e => e.email).join(",");
    openMailWindow({ bcc, subject: applyVars(subject, {}, me()), body: applyVars(body, {}, me()) });
    $("#composeBody").innerHTML = html`<p class="hint">Le mail groupé s'ouvre (${compose.targets.length} adresses en Cci). Une fois envoyé :</p>`;
    $("#composeFoot").innerHTML = html`<button class="btn" data-close>Je n'ai pas envoyé</button><button class="btn primary" id="cAllSent">Marquer les ${compose.targets.length} comme contactées</button>`;
    $("#cAllSent").addEventListener("click", () => busy($("#cAllSent"), async () => {
      const total = compose.targets.length;
      // Une entreprise déjà tracée sort de la liste : un nouvel essai après une erreur ne la trace pas deux fois
      try {
        while (compose.targets.length) {
          await markContacted(compose.targets[0].id, compose.templateId);
          compose.targets.shift();
        }
      } finally { renderAll(); }
      selection.clear();
      closeModals();
      toast(`${total} entreprise${total > 1 ? "s marquées contactées" : " marquée contactée"}`);
    }));
    return;
  }

  compose.idx = 0;
  queueStep();
}

// File de brouillons : un mail personnalisé par destinataire. Le contact n'est tracé
// qu'après confirmation « Envoyé » (fermer l'onglet sans envoyer ne fausse pas l'historique).
function queueStep() {
  const i = compose.idx;
  if (i >= compose.targets.length) {
    selection.clear();
    closeModals();
    renderAll();
    toast("File d'envoi terminée ✓");
    return;
  }
  const e = compose.targets[i];
  const subj = applyVars(compose.subject, e, me());
  const body = applyVars(compose.body, e, me());
  const relance = isRelanceFor(byId(e.id) || e);
  $("#composeBody").innerHTML = html`
    <div class="queue-card">
      <span class="qprog">${i + 1} / ${compose.targets.length}</span>
      <div class="qname">${e.nom} <span class="muted small">→ ${e.email}</span></div>
      <div class="qpreview"><b>${subj}</b>\n\n${body}</div>
      <div class="btnrow" id="qStepA">
        <button class="btn primary" id="qOpen">${icon("mail", 14)} ${modeInfo().button}</button>
        <button class="btn" id="qSkip">Passer sans envoyer</button>
      </div>
      <div class="btnrow" id="qStepB" hidden>
        <button class="btn primary" id="qSent">${icon("check", 14)} Envoyé</button>
        <button class="btn" id="qReopen">Rouvrir le brouillon</button>
        <button class="btn" id="qNotSent">Pas envoyé — passer</button>
      </div>
      <p class="hint">Une fois le mail envoyé, clique « Envoyé » : il sera enregistré comme ${relance ? html`une <b>relance</b>` : html`un <b>1er contact</b>`} daté d'aujourd'hui. N'oublie pas la pièce jointe !</p>
    </div>`;
  $("#composeFoot").innerHTML = html`<button class="btn" data-close>Arrêter la file</button>`;
  const next = () => { compose.idx++; queueStep(); };
  const open = () => {
    openMailWindow({ to: e.email, subject: subj, body });
    $("#qStepA").hidden = true;
    $("#qStepB").hidden = false;
  };
  $("#qOpen").addEventListener("click", open);
  $("#qReopen").addEventListener("click", open);
  $("#qSkip").addEventListener("click", next);
  $("#qNotSent").addEventListener("click", next);
  // En cas d'erreur, on reste sur cette entreprise : passer à la suivante laisserait croire que l'envoi est tracé
  $("#qSent").addEventListener("click", async () => {
    const ok = await busy($("#qSent"), async () => {
      await markContacted(e.id, compose.templateId);
      renderAll();
    });
    if (ok) next();
  });
}
