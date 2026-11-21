// Cloche, badge et panneau de notifications : réponses d'entreprises détectées
// dans la boîte mail. Rafraîchi quand le serveur signale une nouvelle réponse (SSE) ;
// une nouvelle réponse recharge aussi la liste des entreprises (leur statut a pu changer).
import { api } from "../api.js";
import { STATUTS } from "../constants.js";
import { state, byId, loadAll, updateEntreprise } from "../state.js";
import { $, html, rel, toast } from "../utils.js";
import { renderAll } from "./render.js";
import { openDrawer } from "./drawer.js";
import { renderToday } from "./today.js";

let items = [];
let lastUnread = 0;
let firstLoad = true;

const PHRASES = {
  acceptee: "a accepté ta candidature",
  refusee: "a refusé ta candidature",
  piste: "propose une piste / un entretien",
  none: "a répondu — à classer",
};

const MOTIF_LABELS = { refus: "refus", acceptee: "acceptation", piste: "piste" };

// Pourquoi l'analyse automatique a classé (ou non) la réponse : expressions trouvées dans le mail.
// Rend le classement vérifiable, et un faux positif repérable.
function motifsHtml(n) {
  const m = n.motifs;
  if (!m) return "";
  const found = group => Object.entries(group || {}).filter(([, v]) => v.length);
  const strong = found(m.strong);
  const parts = strong.length ? strong : found(m.weak);
  if (!parts.length) return "";
  const lead = !strong.length ? "Indices faibles, non décisifs : "
    : (n.auto && n.classement) || strong.length === 1 ? "Détecté : " : "Signaux contradictoires : ";
  return html`<div class="npmotifs">${lead}${parts.map(([k, v], i) => html`${i ? " · " : ""}${MOTIF_LABELS[k] || k} ${v.map(x => `« ${x} »`).join(", ")}`)}</div>`;
}

const unreadCount = () => items.filter(n => !n.isRead).length;

function updateBadge() {
  const count = unreadCount();
  const badge = $("#notifBadge");
  badge.hidden = count === 0;
  badge.textContent = count > 99 ? "99+" : count;
  $("#btnNotif").setAttribute("aria-label", count ? `Notifications (${count} non lue${count > 1 ? "s" : ""})` : "Notifications");
  state.unread = items.filter(n => !n.isRead);
  renderToday();
}

function itemHtml(n) {
  const nom = n.entreprise || n.fromEmail || "Entreprise supprimée";
  const st = n.classement && STATUTS[n.classement];
  return html`<div class="npitem ${n.isRead ? "" : "unread"}" data-id="${n.id}" role="button" tabindex="0">
    <div class="nptitle"><b>${nom}</b> ${PHRASES[n.classement || "none"]}</div>
    <div class="npmeta">${rel(new Date(n.createdAt))} · ${n.fromEmail}</div>
    ${n.subject && html`<div class="npsubj" title="${n.snippet}">${n.subject}</div>`}
    ${n.snippet && html`<div class="npsnippet">${n.snippet}</div>`}
    ${st
      ? html`<div class="npclass" style="color:${st.color}">→ ${st.label}${n.auto ? " (auto)" : ""}
          ${n.entrepriseId && html`<button class="linkbtn" data-reclass="1">corriger</button>`}</div>`
      : ""}
    ${motifsHtml(n)}
    ${(!st || n.reclassOpen) && n.entrepriseId && html`<div class="npactions">
        <button class="btn small" data-cl="piste">Piste</button>
        <button class="btn small" data-cl="acceptee">Acceptée</button>
        <button class="btn small danger" data-cl="refusee">Refusée</button>
      </div>`}
  </div>`;
}

function renderPanel() {
  $("#npList").innerHTML = items.length
    ? html`${items.map(itemHtml)}`
    : html`<div class="npempty">Aucune notification.<br>Configure ta boîte mail dans les réglages pour détecter les réponses automatiquement.</div>`;
}

export async function refreshNotifications() {
  try {
    items = await api.notifications.list();
  } catch { return; /* serveur momentanément injoignable : on retentera */ }
  const unread = unreadCount();
  if (!firstLoad && unread > lastUnread) {
    // Nouvelles réponses : les statuts ont pu changer côté serveur
    await loadAll().catch(() => {});
    renderAll();
    toast("Nouvelle réponse d'entreprise détectée", "warn");
  }
  firstLoad = false;
  lastUnread = unread;
  updateBadge();
  if (!$("#notifPanel").hidden) renderPanel();
}

async function markRead(n) {
  if (!n || n.isRead) return;
  n.isRead = true;
  lastUnread = unreadCount();
  updateBadge();
  try { await api.notifications.update(n.id, { isRead: true }); } catch { /* réessaiera au prochain refresh */ }
}

async function openItem(n) {
  await markRead(n);
  renderPanel();
  if (n?.entrepriseId && byId(n.entrepriseId)) {
    hideNotifications();
    openDrawer(n.entrepriseId);
  }
}

export function showNotifications() {
  const panel = $("#notifPanel");
  // Sous la cloche tant qu'elle est à l'écran (l'en-tête passe sur deux lignes sur petit écran), sinon en haut
  const bell = $("#btnNotif").getBoundingClientRect();
  panel.style.top = `${Math.max(12, bell.bottom + 8)}px`;
  panel.hidden = false;
  $("#btnNotif").setAttribute("aria-expanded", "true");
  renderPanel();
}

function hideNotifications() {
  $("#notifPanel").hidden = true;
  $("#btnNotif").setAttribute("aria-expanded", "false");
}

// Depuis la vue « Aujourd'hui » : ouvre la fiche concernée, ou le panneau si l'entreprise n'existe plus
export function openNotification(id) {
  const n = items.find(x => x.id === id);
  if (!n) return;
  if (!(n.entrepriseId && byId(n.entrepriseId))) showNotifications();
  openItem(n);
}

export function initNotifications() {
  const panel = $("#notifPanel");

  $("#btnNotif").addEventListener("click", ev => {
    ev.stopPropagation();
    if (panel.hidden) showNotifications(); else hideNotifications();
  });
  document.addEventListener("click", ev => {
    if (!panel.hidden && !ev.target.closest("#notifPanel") && !ev.target.closest("#btnNotif")) hideNotifications();
  });
  document.addEventListener("keydown", ev => { if (ev.key === "Escape" && !panel.hidden) hideNotifications(); });

  $("#npReadAll").addEventListener("click", async () => {
    try {
      await api.notifications.readAll();
      items.forEach(n => { n.isRead = true; });
      lastUnread = 0;
      updateBadge();
      renderPanel();
    } catch (err) { toast(err.message, "err"); }
  });

  $("#npList").addEventListener("keydown", ev => {
    const item = ev.target.closest(".npitem");
    if (item && ev.target === item && (ev.key === "Enter" || ev.key === " ")) {
      ev.preventDefault();
      openItem(items.find(x => x.id === Number(item.dataset.id)));
    }
  });

  $("#npList").addEventListener("click", async ev => {
    const item = ev.target.closest(".npitem");
    if (!item) return;
    const n = items.find(x => x.id === Number(item.dataset.id));
    if (!n) return;

    if (ev.target.closest("[data-reclass]")) {
      n.reclassOpen = !n.reclassOpen;
      renderPanel();
      return;
    }

    const clBtn = ev.target.closest("[data-cl]");
    if (clBtn) {
      const cl = clBtn.dataset.cl;
      const e = byId(n.entrepriseId);
      try {
        if (e) { await updateEntreprise(e.id, { statut: cl }); renderAll(); }
        const updated = await api.notifications.update(n.id, { classement: cl, isRead: true });
        Object.assign(n, updated, { reclassOpen: false });
        lastUnread = unreadCount();
        updateBadge();
        renderPanel();
        toast(`${n.entreprise || "Entreprise"} — classée ${STATUTS[cl].label}`);
      } catch (err) { toast(err.message, "err"); }
      return;
    }

    // Clic sur la notification : marquer lue + ouvrir la fiche de l'entreprise
    openItem(n);
  });

  refreshNotifications();
}
