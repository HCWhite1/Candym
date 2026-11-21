// Suivi des envois SMTP : programmés, envoyés, échoués — annuler ou relancer.
import { api } from "../api.js";
import { OUTBOX_STATUS } from "../constants.js";
import { $, html, toast, fmtDateTime } from "../utils.js";
import { showModal } from "./modals.js";

let items = [];

function rowHtml(o) {
  const st = OUTBOX_STATUS[o.status] || OUTBOX_STATUS.pending;
  const late = o.status === "pending" && new Date(o.sendAt) < new Date(Date.now() - 2 * 60000);
  const when = o.status === "sent" ? `envoyé ${fmtDateTime(o.sentAt)}` : `prévu ${fmtDateTime(o.sendAt)}`;
  return html`<div class="obrow">
    <span class="obstatus ${st.cls}">${st.label}</span>
    <div class="obmain">
      <div class="obtitle"><b>${o.entreprise || "Entreprise supprimée"}</b> <span class="muted small">→ ${o.toEmail}</span></div>
      <div class="obsubj">${o.subject}</div>
      <div class="obmeta">${when}${o.attachments.length > 0 && ` · ${o.attachments.length} pièce(s) jointe(s)`}${late && html` · <span class="warn-text">en retard</span>`}</div>
      ${o.error && html`<div class="oberror">${o.error}</div>`}
    </div>
    <div class="obactions">
      ${["pending", "failed"].includes(o.status) && html`<button class="btn small" data-obcancel="${o.id}">Annuler</button>`}
      ${["failed", "cancelled"].includes(o.status) && html`<button class="btn small" data-obretry="${o.id}">Renvoyer</button>`}
    </div>
  </div>`;
}

function renderList() {
  const pending = items.filter(o => ["pending", "sending"].includes(o.status)).length;
  const failed = items.filter(o => o.status === "failed").length;
  $("#outboxSummary").textContent = items.length
    ? `${pending} programmé(s) · ${failed} en échec · ${items.filter(o => o.status === "sent").length} envoyé(s)`
    : "";
  $("#outboxList").innerHTML = items.length
    ? html`${items.map(rowHtml)}`
    : html`<p class="hint">Aucun envoi. En mode SMTP (Réglages → Envoi des mails), les mails envoyés ou programmés depuis l'app apparaissent ici.</p>`;
}

export async function refreshOutbox() {
  try {
    items = await api.outbox.list();
  } catch { return; }
  const pending = items.filter(o => ["pending", "sending"].includes(o.status)).length;
  const failed = items.filter(o => o.status === "failed").length;
  const badge = $("#outboxCount");
  badge.textContent = failed ? `(${failed} ⚠)` : pending ? `(${pending})` : "";
  badge.classList.toggle("warn-text", failed > 0);
  if ($("#mOutbox").classList.contains("show")) renderList();
}

export async function openOutbox() {
  showModal("#mOutbox");
  renderList();
  await refreshOutbox();
  renderList();
}

export function initOutbox() {
  $("#btnOutbox").addEventListener("click", openOutbox);
  $("#outboxList").addEventListener("click", async ev => {
    const cancel = ev.target.closest("[data-obcancel]");
    const retry = ev.target.closest("[data-obretry]");
    try {
      if (cancel) {
        if (!confirm("Annuler cet envoi ?")) return;
        await api.outbox.cancel(Number(cancel.dataset.obcancel));
        toast("Envoi annulé");
      } else if (retry) {
        await api.outbox.retry(Number(retry.dataset.obretry));
        toast("Envoi relancé");
      } else return;
      await refreshOutbox();
    } catch (err) { toast(err.message, "err"); }
  });
  refreshOutbox();
}
