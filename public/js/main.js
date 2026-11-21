// Point d'entrée : chargement des données puis câblage des événements globaux.
import { subscribe } from "./api.js";
import { filter, selection, view, byId, loadAll, reloadEntreprises, changeStatut } from "./state.js";
import { $, toast } from "./utils.js";
import { mountIcons } from "./icons.js";
import { renderAll, renderStats, renderList, renderSelection, visibleList, initClock } from "./ui/render.js";
import { initKanban } from "./ui/kanban.js";
import { closeModals, initModals } from "./ui/modals.js";
import { openDrawer, closeDrawer, openId, initDrawer, openRelance } from "./ui/drawer.js";
import { openEdit, initEdit } from "./ui/edit.js";
import { openCompose } from "./ui/compose.js";
import { initTemplates } from "./ui/templates.js";
import { initVault } from "./ui/vault.js";
import { initSettings } from "./ui/settings.js";
import { initNotifications, refreshNotifications, openNotification, showNotifications } from "./ui/notifications.js";
import { initToday } from "./ui/today.js";
import { initOutbox, refreshOutbox } from "./ui/outbox.js";
import { initStats } from "./ui/stats.js";
import { initAnnuaire } from "./ui/annuaire.js";

mountIcons(); // hydrate les <i data-icon> du HTML statique

/* ---------- Filtres, recherche, vue ---------- */
$("#stats").addEventListener("click", ev => {
  const b = ev.target.closest("[data-stat]");
  if (!b) return;
  const v = b.dataset.stat;
  if (v === "all") { filter.statut = null; filter.relanceOnly = false; }
  else if (v === "relance") { filter.relanceOnly = !filter.relanceOnly; filter.statut = null; }
  else { filter.statut = filter.statut === v ? null : v; filter.relanceOnly = false; }
  renderStats();
  renderList();
});
$("#q").addEventListener("input", ev => { filter.q = ev.target.value; renderList(); });
$("#tagFilter").addEventListener("change", ev => { filter.tag = ev.target.value; renderList(); });
$("#sort").addEventListener("change", renderList);
$("#viewToggle").addEventListener("click", () => {
  view.mode = view.mode === "kanban" ? "table" : "kanban";
  renderList();
});

/* ---------- Tableau : sélection, statut inline, ouverture du détail ---------- */
$("#tbody").addEventListener("click", ev => {
  // Toute la cellule de la case à cocher sélectionne : un clic à côté de la case n'ouvre plus la fiche
  const cell = ev.target.closest("td.check");
  if (cell) {
    const cb = cell.querySelector(".rowcheck");
    if (ev.target !== cb) cb.checked = !cb.checked;
    const id = Number(cb.dataset.id);
    if (cb.checked) selection.add(id); else selection.delete(id);
    renderSelection(); // mise à jour ciblée : la case garde le focus clavier
    return;
  }
  if (ev.target.closest(".rowstatut")) return;
  const mail = ev.target.closest(".actmail");
  if (mail) { openCompose([Number(mail.dataset.id)]); return; }
  if (ev.target.closest("a,button")) return; // liens site / téléphone : pas d'ouverture de la fiche
  const tr = ev.target.closest("tr[data-id]");
  if (tr) openDrawer(Number(tr.dataset.id));
});
// Au clavier : Entrée sur une ligne ouvre sa fiche
$("#tbody").addEventListener("keydown", ev => {
  if (ev.key === "Enter" && ev.target.matches("tr[data-id]")) openDrawer(Number(ev.target.dataset.id));
});

async function moveTo(id, statut) {
  const e = byId(id);
  if (!e || e.statut === statut) return;
  try {
    await changeStatut(e, statut);
    renderAll();
    if (openId === e.id) openDrawer(e.id);
  } catch (err) {
    toast(err.message, "err");
    renderAll();
  }
}

$("#tbody").addEventListener("change", ev => {
  const sel = ev.target.closest(".rowstatut");
  if (sel) moveTo(Number(sel.dataset.id), sel.value);
});
$("#checkAll").addEventListener("change", ev => {
  const vis = visibleList().filter(e => e.email);
  if (ev.target.checked) vis.forEach(e => selection.add(e.id));
  else vis.forEach(e => selection.delete(e.id));
  renderSelection();
});
$("#btnClearSel").addEventListener("click", () => { selection.clear(); renderSelection(); });
$("#btnContact").addEventListener("click", () => openCompose([...selection]));

initKanban({ onMove: moveTo, onOpen: openDrawer, onRender: renderList });

initToday({
  onOpen: openDrawer,
  onRelance: openRelance,
  onOpenNotif: openNotification,
  onShowNotifs: showNotifications,
  onShowRelances: () => {
    filter.relanceOnly = true;
    filter.statut = null;
    renderStats();
    renderList();
    $("#stats").scrollIntoView({ behavior: "smooth", block: "start" });
  },
});

/* ---------- Drawer & modales : fermeture globale ---------- */
initModals(); // boutons « fermer » et clic sur le fond d'une modale
$("#overlay").addEventListener("click", closeDrawer);
document.addEventListener("keydown", ev => {
  if (ev.key !== "Escape") return;
  if (document.querySelector(".modal.show")) closeModals();
  else closeDrawer();
});
$("#dEdit").addEventListener("click", () => { if (openId) openEdit(openId); });

/* ---------- Temps réel ---------- */
// Le serveur pousse les nouveautés (SSE). Si la connexion tombe, polling de secours toutes les 5 min.
let fallback = null;
let lost = false; // la connexion est tombée au moins une fois depuis le dernier chargement complet

async function refreshEntreprises(load = reloadEntreprises) {
  try {
    await load();
    renderAll();
    if (openId) openDrawer(openId);
    return true;
  } catch { return false; /* prochain événement */ }
}

subscribe({
  notifications: () => refreshNotifications(),
  outbox: () => refreshOutbox(),
  entreprises: () => refreshEntreprises(),
}, async connected => {
  $("#apperror").classList.toggle("show", !connected && document.visibilityState === "visible" && !!fallback);
  if (connected) {
    clearInterval(fallback);
    fallback = null;
    // Serveur relancé (ou premier chargement raté) : les données affichées peuvent dater, on recharge tout
    if (lost && await refreshEntreprises(loadAll)) lost = false;
    refreshNotifications();
    refreshOutbox();
  } else {
    lost = true;
    fallback ??= setInterval(() => { refreshNotifications(); refreshOutbox(); }, 5 * 60000);
  }
});

/* ---------- Démarrage ---------- */
initDrawer();
initEdit();
initTemplates();
initVault();
initSettings();
initNotifications();
initOutbox();
initStats();
initAnnuaire({ openEdit });
initClock();

(async () => {
  try {
    await loadAll();
    renderAll();
  } catch (err) {
    console.error(err);
    $("#apperror").classList.add("show");
    lost = true; // sera rechargé dès que le serveur répond de nouveau
  }
})();
