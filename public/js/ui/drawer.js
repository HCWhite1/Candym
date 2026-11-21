// Panneau de détail d'une entreprise, flux « réponse reçue » et « noter un contact ».
import { state, byId, lastContact, needsRelance, isRelanceFor, changeStatut, updateEntreprise, logContact, relanceTemplate } from "../state.js";
import { $, html, rel, fmtDate, fmtDateTime, toast, busy, safeUrl, telHref, download, icsEvent, toLocalInput } from "../utils.js";
import { TEMPLATE_KINDS } from "../constants.js";
import { icon } from "../icons.js";
import { renderAll, statutSelectHtml, pertBadge } from "./render.js";
import { showModal, closeModals, syncLayers } from "./modals.js";
import { openCompose } from "./compose.js";
import { openEnrich } from "./annuaire.js";

export let openId = null;

const TL_LABELS = { contact: "Contact", relance: "Relance", reponse: "Réponse reçue", note: "Note" };
const field = (label, value, cls = "") => html`<div class="field ${cls}"><span class="flabel">${label}</span><div class="val">${value || "—"}</div></div>`;

// Notes libres : enregistrées à la sortie du champ, et aussi avant que la fiche soit fermée ou
// redessinée — sinon une note tapée puis « Échap » était perdue au prochain rendu.
// (un <textarea> rend toujours des fins de ligne « \n » : la comparaison se fait sur la même forme)
const noteChanged = (el, e) => el.value !== String(e.note ?? "").replace(/\r\n?/g, "\n");

function saveNote() {
  const el = $("#dNote");
  const e = el && byId(openId);
  if (!e || !noteChanged(el, e)) return;
  updateEntreprise(e.id, { note: el.value }).catch(err => toast(err.message, "err"));
}

export function openDrawer(id) {
  const e = byId(id);
  if (!e) { if (openId === Number(id)) closeDrawer(); return; }
  // Même fiche redessinée (statut changé, événement serveur…) : la saisie en cours dans les notes est conservée
  const prev = openId === e.id ? $("#dNote") : null;
  const draft = prev && noteChanged(prev, e)
    ?{ value: prev.value, focus: document.activeElement === prev, start: prev.selectionStart, end: prev.selectionEnd }
    : null;
  if (!draft) saveNote();
  const scroll = openId === e.id ? $("#dBody").scrollTop : 0;
  openId = e.id;
  $("#dTitle").textContent = e.nom;
  const lc = lastContact(e);
  const hist = [...(e.historique || [])].sort((a, b) => b.date.localeCompare(a.date));
  const tplName = tid => state.templates.find(t => t.id === tid)?.name;
  const url = safeUrl(e.url);
  const entretien = e.dateEntretien ? new Date(e.dateEntretien) : null;
  const canRelance = !!e.email && isRelanceFor(e);

  $("#dBody").innerHTML = html`
    <div class="grid2">
      <div class="field"><label for="dStatut" class="flabel">Statut</label>${statutSelectHtml(e)}</div>
      ${field("Pertinence", html`<span class="pertline">${pertBadge(e)}<span class="muted small">${e.pertinenceNote}</span></span>`)}
      ${field("Activité", e.activite)}
      ${field("Ville", [e.ville, e.cp].filter(Boolean).join(" "))}
      ${field("Email", e.email && html`<a href="mailto:${e.email}">${e.email}</a>`)}
      ${field("Téléphone", e.tel && html`<a href="${telHref(e.tel)}">${e.tel}</a>`)}
      ${field("Interlocuteur", [e.contactNom, e.contactPoste].filter(Boolean).join(" — "))}
      ${field("Entretien", entretien && html`${fmtDateTime(entretien)}
        <button class="btn small" id="dIcs">${icon("calendar", 13)} Ajouter à l'agenda</button>`)}
    </div>
    ${field("Adresse", e.adresse)}
    ${field("Site", url && html`<a href="${url}" target="_blank" rel="noopener noreferrer">${e.url}</a>`)}
    ${e.siren && field("SIREN", html`<a href="https://annuaire-entreprises.data.gouv.fr/entreprise/${e.siren}" target="_blank" rel="noopener noreferrer">${e.siren}</a>`)}
    ${needsRelance(e) && html`<div class="hint warn">${icon("clock", 14)} Dernier contact ${rel(lc)} — au-delà du délai de ${state.settings.delaiRelance} j. Pense à relancer.</div>`}
    <div class="dsection">
      <h3>Actions</h3>
      <div class="btnrow">
        <button class="btn small primary" id="dContact" ${e.email ? "" : "disabled"}>${icon("mail", 14)} Contacter</button>
        <button class="btn small" id="dRelance" ${canRelance ? "" : "disabled"} title="${canRelance ? "Ouvre le modèle de relance" : e.email ? "Pas encore contactée : commence par « Contacter »" : "Pas d’email connu"}">${icon("refresh", 14)} Relancer par mail</button>
        <button class="btn small" id="dReponse">${icon("check", 14)} Réponse reçue…</button>
        <button class="btn small" id="dLog">${icon("plus", 14)} Noter un échange</button>
        <button class="btn small" id="dEnrich">${icon("building", 14)} Compléter depuis l'annuaire</button>
      </div>
    </div>
    <div class="dsection">
      <h3><label for="dNote">Notes</label></h3>
      <textarea id="dNote" rows="3" placeholder="Notes libres…">${e.note}</textarea>
    </div>
    <div class="dsection">
      <h3>Historique</h3>
      ${hist.length ? html`<div class="timeline">${hist.map(h => html`
        <div class="tl-item t-${h.type}">
          <div class="tl-date">${fmtDate(h.date)}</div>
          <div class="tl-txt">${TL_LABELS[h.type] || h.type}${h.moyen && ` — ${h.moyen}`}${tplName(h.templateId) && html` <span class="muted small">(modèle « ${tplName(h.templateId)} »)</span>`}</div>
          ${h.note && html`<div class="tl-note">${h.note}</div>`}
        </div>`)}</div>` : html`<p class="hint">Aucun contact enregistré.</p>`}
    </div>`;

  const statutSel = $("#dBody .rowstatut");
  statutSel.id = "dStatut";
  statutSel.addEventListener("change", async ev => {
    try {
      await changeStatut(byId(e.id), ev.target.value);
      renderAll();
      openDrawer(e.id);
    } catch (err) { toast(err.message, "err"); }
  });
  const note = $("#dNote");
  note.addEventListener("change", saveNote);
  if (draft) {
    note.value = draft.value;
    if (draft.focus) { note.focus(); note.setSelectionRange(draft.start, draft.end); }
  }
  $("#dBody").scrollTop = scroll;
  $("#dContact").addEventListener("click", () => openCompose([e.id]));
  $("#dRelance").addEventListener("click", () => openRelance(e.id));
  $("#dReponse").addEventListener("click", () => openReponse(e.id));
  $("#dLog").addEventListener("click", () => openLog(e.id));
  $("#dEnrich").addEventListener("click", () => openEnrich(e.id));
  $("#dIcs")?.addEventListener("click", () => {
    download(`entretien-${e.nom.replace(/[^\p{L}\p{N}]+/gu, "-")}.ics`, icsEvent({
      uid: `entretien-${e.id}-${e.dateEntretien}@radar-alternance`,
      start: entretien,
      title: `Entretien — ${e.nom}`,
      location: [e.adresse, e.cp, e.ville].filter(Boolean).join(" "),
      description: [e.contactNom && `Interlocuteur : ${e.contactNom}${e.contactPoste ? ` (${e.contactPoste})` : ""}`, e.tel && `Tél : ${e.tel}`, e.note].filter(Boolean).join("\n"),
    }), "text/calendar;charset=utf-8");
  });

  const wasOpen = $("#drawer").classList.contains("show");
  $("#drawer").classList.add("show");
  syncLayers();
  if (!wasOpen && !document.querySelector(".modal.show")) $("#dClose").focus({ preventScroll: true });
}

// Écran d'envoi prérempli avec le premier modèle de type « Relance »
export function openRelance(id) {
  const tpl = relanceTemplate();
  if (!tpl) toast("Aucun modèle de type « Relance » : choisis-en un dans la liste ou crée-le dans Modèles", "warn");
  openCompose([id], tpl?.id);
}

export function closeDrawer() {
  if (!$("#drawer").classList.contains("show")) return;
  saveNote();
  $("#drawer").classList.remove("show");
  openId = null;
  syncLayers();
}

/* ---------- Modal « Réponse reçue » ---------- */
let repId = null;

const REP_CHOICES = [
  ["piste", "Positive — piste / entretien", "On avance ! Tu peux ajouter la date d'entretien dans la fiche."],
  ["acceptee", "Acceptée", "Candidature retenue."],
  ["refusee", "Refus", "Classée, mais l'historique reste."],
  ["contacte", "Neutre — toujours en attente", "Ex : accusé de réception. Le délai de relance repart de zéro."],
];

export function openReponse(id) {
  const e = byId(id);
  if (!e) return;
  repId = e.id;
  $("#repNom").textContent = e.nom;
  $("#repNote").value = "";
  $("#repChoices").innerHTML = html`${REP_CHOICES.map(([v, l, d], i) => html`
    <label><input type="radio" name="repChoice" value="${v}" ${i === 0 ? "checked" : ""}><span>${l}<small>${d}</small></span></label>`)}`;
  showModal("#mReponse");
}

/* ---------- Modal « Noter un échange » (téléphone, forum, formulaire…) ---------- */
let logId = null;

export function openLog(id) {
  const e = byId(id);
  if (!e) return;
  logId = e.id;
  $("#logNom").textContent = e.nom;
  $("#logMoyen").value = "Tél";
  $("#logDate").value = toLocalInput(new Date());
  $("#logNote").value = "";
  $("#logType").value = "contact";
  $("#logTpl").innerHTML = html`<option value="">— aucun —</option>
    ${state.templates.map(t => html`<option value="${t.id}">${t.name} · ${TEMPLATE_KINDS[t.kind] || "Autre"}</option>`)}`;
  $("#logTplField").hidden = false;
  showModal("#mLog");
  $("#logMoyen").focus();
}

export function initDrawer() {
  $("#dClose").addEventListener("click", closeDrawer);

  $("#repSave").addEventListener("click", async () => {
    const e = byId(repId);
    if (!e) return;
    const choice = document.querySelector('input[name="repChoice"]:checked').value;
    const note = $("#repNote").value.trim();
    // Réponse neutre : l'entreprise reste en attente (une relance déjà faite reste une relance).
    // La réponse datée d'aujourd'hui est le dernier échange : le délai de relance repart de zéro tout seul.
    const statut = choice === "contacte" && e.statut === "relancee" ? "relancee" : choice;
    await busy($("#repSave"), async () => {
      await logContact(e.id, { type: "reponse", moyen: "", note, statut });
      closeModals();
      renderAll();
      if (openId === repId) openDrawer(repId);
      toast("Réponse enregistrée");
    });
  });

  // Une simple note n'est pas un envoi : pas de modèle à rattacher
  $("#logType").addEventListener("change", () => { $("#logTplField").hidden = $("#logType").value === "note"; });

  $("#logSave").addEventListener("click", async () => {
    const e = byId(logId);
    if (!e) return;
    const type = $("#logType").value;
    const when = $("#logDate").value ? new Date($("#logDate").value) : new Date();
    if (Number.isNaN(when.getTime())) { toast("Date invalide", "err"); return; }
    const entry = { type, moyen: $("#logMoyen").value.trim() || "Autre", note: $("#logNote").value.trim(), date: when.toISOString() };
    if (type !== "note") entry.templateId = Number($("#logTpl").value) || null;
    // Un premier contact fait passer une entreprise « à contacter / à évaluer » en « contactée »
    if (type === "contact" && ["a_contacter", "a_evaluer"].includes(e.statut)) entry.statut = "contacte";
    if (type === "relance" && ["a_contacter", "a_evaluer", "contacte"].includes(e.statut)) entry.statut = "relancee";
    await busy($("#logSave"), async () => {
      await logContact(e.id, entry);
      closeModals();
      renderAll();
      if (openId === logId) openDrawer(logId);
      toast(type === "note" ? "Note ajoutée" : "Échange enregistré");
    });
  });
}
