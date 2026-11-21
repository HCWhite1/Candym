// Vue Kanban : une colonne par statut, cartes déplaçables pour changer de statut.
import { STATUTS, STATUT_ORDER } from "../constants.js";
import { lastContact, needsRelance } from "../state.js";
import { $, html, rel } from "../utils.js";

let collapsed = new Set(["fermee"]);
try { collapsed = new Set(JSON.parse(localStorage.getItem("radar.kanban.collapsed") ?? '["fermee"]')); } catch { /* défaut */ }
const saveCollapsed = () => {
  try { localStorage.setItem("radar.kanban.collapsed", JSON.stringify([...collapsed])); } catch { /* stockage indisponible */ }
};

// Pastilles importées paresseusement pour éviter un import circulaire avec render.js
let chips = { entretienChip: () => "", pertBadge: () => "" };
export const setChipRenderers = r => { chips = r; };

function cardHtml(e) {
  const lc = lastContact(e);
  return html`<article class="kcard" draggable="true" tabindex="0" role="button" data-id="${e.id}" aria-label="Ouvrir la fiche de ${e.nom}">
    <div class="kc-top">${chips.pertBadge(e)}<span class="kc-nom">${e.nom}</span></div>
    ${(e.ville || e.activite) && html`<div class="kc-meta">${[e.activite, e.ville].filter(Boolean).join(" · ")}</div>`}
    <div class="kc-foot">
      <span class="lastc ${lc ? "" : "never"}">${lc ? rel(lc) : "jamais contactée"}</span>
      ${needsRelance(e) && html`<span class="relance-chip">à relancer</span>`}
    </div>
    ${chips.entretienChip(e)}
  </article>`;
}

export function renderKanban(list) {
  const board = $("#kanban");
  const groups = Object.fromEntries(STATUT_ORDER.map(k => [k, []]));
  for (const e of list) groups[e.statut]?.push(e);
  // Chaque colonne défile seule : sa position (et la carte active) survit au nouveau rendu,
  // sinon tout changement de statut ou le rafraîchissement de chaque minute ramenait les colonnes en haut.
  const scroll = Object.fromEntries([...board.querySelectorAll(".kcol")].map(c => [c.dataset.statut, c.querySelector(".kcol-body").scrollTop]));
  const active = board.contains(document.activeElement) ? document.activeElement : null;
  const focusId = active?.closest(".kcard")?.dataset.id;
  const focusToggle = active?.closest(".kcol-toggle")?.dataset.toggle;
  board.innerHTML = html`${STATUT_ORDER.map(k => {
    const closed = collapsed.has(k);
    return html`<section class="kcol ${closed ? "collapsed" : ""}" data-statut="${k}" style="--st:${STATUTS[k].color}" aria-label="${STATUTS[k].label}">
      <button class="kcol-toggle" data-toggle="${k}" aria-expanded="${closed ? "false" : "true"}" title="${closed ? "Déplier" : "Replier"}">
        <span class="dot"></span><span class="kcol-title">${STATUTS[k].label}</span><b>${groups[k].length}</b>
      </button>
      <div class="kcol-body">${closed ? "" : groups[k].map(cardHtml)}</div>
    </section>`;
  })}`;
  for (const col of board.querySelectorAll(".kcol")) col.querySelector(".kcol-body").scrollTop = scroll[col.dataset.statut] || 0;
  if (focusId) board.querySelector(`.kcard[data-id="${Number(focusId)}"]`)?.focus({ preventScroll: true });
  else if (focusToggle in STATUTS) board.querySelector(`[data-toggle="${focusToggle}"]`)?.focus({ preventScroll: true });
}

// onMove(id, statut) : changement de statut par glisser-déposer ; onOpen(id) : ouvrir la fiche
export function initKanban({ onMove, onOpen, onRender }) {
  const board = $("#kanban");
  let dragId = null;

  board.addEventListener("click", ev => {
    const t = ev.target.closest("[data-toggle]");
    if (t) {
      const k = t.dataset.toggle;
      if (collapsed.has(k)) collapsed.delete(k); else collapsed.add(k);
      saveCollapsed();
      onRender();
      return;
    }
    const card = ev.target.closest(".kcard");
    if (card) onOpen(Number(card.dataset.id));
  });
  board.addEventListener("keydown", ev => {
    const card = ev.target.closest(".kcard");
    if (card && ev.target === card && (ev.key === "Enter" || ev.key === " ")) {
      ev.preventDefault();
      onOpen(Number(card.dataset.id));
    }
  });

  board.addEventListener("dragstart", ev => {
    const card = ev.target.closest(".kcard");
    if (!card) return;
    dragId = Number(card.dataset.id);
    card.classList.add("dragging");
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", String(dragId));
  });
  board.addEventListener("dragend", ev => {
    ev.target.closest(".kcard")?.classList.remove("dragging");
    board.querySelectorAll(".kcol.over").forEach(c => c.classList.remove("over"));
    dragId = null;
  });
  board.addEventListener("dragover", ev => {
    const col = ev.target.closest(".kcol");
    if (!col || dragId === null) return;
    ev.preventDefault();
    board.querySelectorAll(".kcol.over").forEach(c => c !== col && c.classList.remove("over"));
    col.classList.add("over");
  });
  board.addEventListener("drop", ev => {
    const col = ev.target.closest(".kcol");
    if (!col || dragId === null) return;
    ev.preventDefault();
    col.classList.remove("over");
    onMove(dragId, col.dataset.statut);
  });
}
