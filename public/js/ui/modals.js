// Couches au-dessus de la page : la fiche (panneau latéral) et les modales.
// Une seule règle pour toutes : la couche du dessus reçoit le clavier, le reste de la page
// est figé (attribut inert, défilement verrouillé), et la fermeture rend le focus à son point de départ.
import { $, $$ } from "../utils.js";

const FOCUSABLE_PARTS = ["input:not([type=hidden]):not([disabled])", "select:not([disabled])", "textarea:not([disabled])", "button:not([disabled])", "a[href]"];
const FOCUSABLE = FOCUSABLE_PARTS.join(", ");
// Le préfixe doit s'appliquer à chaque sélecteur de la liste, pas seulement au premier
const IN_BODY = FOCUSABLE_PARTS.map(s => ".mbody " + s).join(", ");

let returnFocus = null; // élément qui avait le focus avant l'ouverture de la modale

export function syncLayers() {
  const modal = document.querySelector(".modal.show");
  const drawer = $("#drawer");
  const drawerOpen = drawer.classList.contains("show");
  const top = modal || (drawerOpen ? drawer : null);

  $("#overlay").classList.toggle("show", drawerOpen);
  const root = document.documentElement;
  if (top && !root.classList.contains("locked")) {
    // La barre de défilement disparaît : sa largeur est compensée pour que la page ne saute pas
    root.style.setProperty("--sbw", `${window.innerWidth - root.clientWidth}px`);
  }
  root.classList.toggle("locked", !!top);
  for (const el of document.body.children) {
    if (el.id === "toasts" || el.tagName === "SCRIPT") continue;
    el.inert = top ? el !== top : el === drawer;
  }
}

export function showModal(sel) {
  const modal = $(sel);
  const active = document.activeElement;
  if (!document.querySelector(".modal.show")) returnFocus = active;
  for (const m of $$(".modal.show")) if (m !== modal) m.classList.remove("show");
  modal.classList.add("show");
  modal.scrollTop = 0;
  syncLayers();
  // Le clavier arrive dans la modale ; un écran qui place lui-même le focus ensuite garde la main
  if (!modal.contains(document.activeElement)) (modal.querySelector(IN_BODY) || modal.querySelector(FOCUSABLE))?.focus();
}

export function closeModals() {
  const open = $$(".modal.show");
  if (!open.length) return;
  open.forEach(m => m.classList.remove("show"));
  syncLayers();
  if (returnFocus?.isConnected && !returnFocus.closest("[inert]")) returnFocus.focus();
  returnFocus = null;
}

// Clic sur le fond assombri d'une modale : fermeture. Le clic doit commencer ET finir sur le fond,
// sinon une sélection de texte relâchée hors de la boîte fermerait la modale en perdant la saisie.
export function initModals() {
  let downOnBackdrop = false;
  document.addEventListener("mousedown", ev => { downOnBackdrop = ev.target.classList?.contains("modal") ?? false; });
  document.addEventListener("click", ev => {
    if (ev.target.closest("[data-close]") || (downOnBackdrop && ev.target.classList?.contains("modal"))) closeModals();
  });
}
