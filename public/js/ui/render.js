// Rendu de la liste : vue « Aujourd'hui », compteurs-filtres, tableau ou kanban, barre de sélection, horloge.
import { STATUTS, STATUT_ORDER, PERT_ORDER, ROW_TINT_CLASS } from "../constants.js";
import { state, filter, selection, view, lastContact, needsRelance } from "../state.js";
import { $, $$, html, rel, safeUrl, telHref, fmtDateTime } from "../utils.js";
import { icon } from "../icons.js";
import { renderKanban, setChipRenderers } from "./kanban.js";
import { renderToday } from "./today.js";

function counts() {
  const c = { total: state.entreprises.length, relance: 0 };
  for (const k in STATUTS) c[k] = 0;
  for (const e of state.entreprises) {
    c[e.statut] = (c[e.statut] || 0) + 1;
    if (needsRelance(e)) c.relance++;
  }
  return c;
}

export function renderStats() {
  const c = counts();
  // Un statut filtré reste affiché même vide : sinon le filtre actif n'aurait plus de bouton pour le retirer
  const shown = STATUT_ORDER.filter(k => c[k] || filter.statut === k);
  const pressed = on => (on ? "true" : "false");
  $("#stats").innerHTML = html`
    <button class="stat ${!filter.statut && !filter.relanceOnly ? "active" : ""}" data-stat="all" aria-pressed="${pressed(!filter.statut && !filter.relanceOnly)}"><b>${c.total}</b> entreprise${c.total > 1 ? "s" : ""}</button>
    <button class="stat ${c.relance ? "urgent" : ""} ${filter.relanceOnly ? "active" : ""}" data-stat="relance" aria-pressed="${pressed(filter.relanceOnly)}"><span class="dot dot-amber"></span><b>${c.relance}</b> à relancer</button>
    ${shown.map(k => html`
      <button class="stat ${filter.statut === k ? "active" : ""}" data-stat="${k}" aria-pressed="${pressed(filter.statut === k)}"><span class="dot" style="background:${STATUTS[k].color}"></span><b>${c[k]}</b> ${STATUTS[k].label}</button>`)}`;
}

const byNom = (a, b) => a.nom.localeCompare(b.nom, "fr");
const statutRank = Object.fromEntries(STATUT_ORDER.map((k, i) => [k, i]));

// Comparateurs par tri. Ils reçoivent { e, lc, relance } : dernier contact (ms) et relance due,
// calculés une seule fois par entreprise et non à chaque comparaison.
const SORTS = {
  nom: (a, b) => byNom(a.e, b.e),
  dernier: (a, b) => b.lc - a.lc || byNom(a.e, b.e),
  ancien: (a, b) => a.lc - b.lc || byNom(a.e, b.e),
  pertinence: (a, b) => (PERT_ORDER[a.e.pertinence] ?? 3) - (PERT_ORDER[b.e.pertinence] ?? 3) || byNom(a.e, b.e),
  statut: (a, b) => statutRank[a.e.statut] - statutRank[b.e.statut] || byNom(a.e, b.e),
  // relances d'abord (plus ancien contact en premier), puis à contacter, puis le reste
  urgence(a, b) {
    if (a.relance !== b.relance) return a.relance ? -1 : 1;
    if (a.relance) return a.lc - b.lc;
    const pa = a.e.statut === "a_contacter", pb = b.e.statut === "a_contacter";
    if (pa !== pb) return pa ? -1 : 1;
    return SORTS.statut(a, b);
  },
};

export function visibleList() {
  const q = filter.q.trim().toLowerCase();
  const rows = [];
  for (const e of state.entreprises) {
    const relance = needsRelance(e);
    if (filter.relanceOnly && !relance) continue;
    if (filter.statut && e.statut !== filter.statut) continue;
    if (filter.tag && !(e.tags || []).includes(filter.tag)) continue;
    if (q) {
      const hay = [e.nom, e.ville, e.cp, e.activite, e.note, e.email, e.pertinenceNote, e.contactNom, (e.tags || []).join(" ")].join(" ").toLowerCase();
      if (!hay.includes(q)) continue;
    }
    rows.push({ e, relance, lc: lastContact(e)?.getTime() ?? 0 });
  }
  return rows.sort(SORTS[$("#sort").value] || SORTS.urgence).map(r => r.e);
}

export function statutSelectHtml(e) {
  const color = (STATUTS[e.statut] || STATUTS.a_evaluer).color;
  return html`<select class="rowstatut" data-id="${e.id}" aria-label="Statut de ${e.nom}" style="--st:${color}">
    ${STATUT_ORDER.map(k => html`<option value="${k}" ${e.statut === k ? "selected" : ""}>${STATUTS[k].label}</option>`)}
  </select>`;
}

// Entretien à venir (ou du jour) : pastille visible dans la liste et le kanban
export function entretienChip(e) {
  if (!e.dateEntretien) return "";
  const d = new Date(e.dateEntretien);
  if (d.getTime() < Date.now() - 12 * 3600000) return "";
  return html`<div class="entretien-chip">${icon("calendar", 12)} Entretien ${fmtDateTime(d)}</div>`;
}

export const pertBadge = e => html`<span class="pert ${e.pertinence || "none"}" title="${e.pertinenceNote || (e.pertinence ? `Pertinence ${e.pertinence}` : "Pertinence non évaluée")}">${e.pertinence ? e.pertinence[0].toUpperCase() : "?"}</span>`;

setChipRenderers({ entretienChip, pertBadge });

function rowHtml(e) {
  const lc = lastContact(e);
  const meta = [e.activite, [e.ville, e.cp].filter(Boolean).join(" "), e.contactNom].filter(Boolean);
  const url = safeUrl(e.url);
  const rowClass = [ROW_TINT_CLASS[e.statut], selection.has(e.id) && "selected"].filter(Boolean).join(" ");
  return html`<tr data-id="${e.id}" class="${rowClass}" tabindex="0">
    <td class="check"><input type="checkbox" class="rowcheck" data-id="${e.id}" aria-label="Sélectionner ${e.nom}" ${selection.has(e.id) ? "checked" : ""} ${e.email ? "" : html`title="Pas d’email connu"`}></td>
    <td>
      <div class="ent-nom">${e.nom}${(e.tags || []).map(t => html`<span class="tag">${t}</span>`)}</div>
      <div class="ent-meta">${meta.map((m, i) => html`${i ? html`<span class="sep">·</span>` : ""}${m}`)}</div>
      ${entretienChip(e)}
    </td>
    <td>${pertBadge(e)}</td>
    <td>${statutSelectHtml(e)}</td>
    <td><div class="lastc ${lc ? "" : "never"}" ${lc && html`title="${fmtDateTime(lc)}"`}>${lc ? rel(lc) : "jamais"}</div>${needsRelance(e) && html`<div class="relance-chip">à relancer</div>`}</td>
    <td class="hide-sm"><div class="rowactions">
      <button class="iconbtn actmail" data-id="${e.id}" title="${e.email ? "Contacter par mail" : "Pas d’email connu"}" aria-label="Contacter ${e.nom} par mail" ${e.email ? "" : "disabled"}>${icon("mail")}</button>
      ${url && html`<a class="iconbtn" href="${url}" target="_blank" rel="noopener noreferrer" title="Site web" aria-label="Site web de ${e.nom}">${icon("globe")}</a>`}
      ${e.tel && html`<a class="iconbtn" href="${telHref(e.tel)}" title="${e.tel}" aria-label="Appeler ${e.nom}">${icon("phone")}</a>`}
    </div></td>
  </tr>`;
}

// Liste vide : le message dit pourquoi (aucune entreprise suivie, ou filtres trop serrés)
function renderEmpty(list) {
  const box = $("#empty");
  box.hidden = list.length > 0 || !state.loaded;
  if (box.hidden) return;
  box.innerHTML = state.entreprises.length
    ? html`Aucune entreprise ne correspond.<br><b>Modifie la recherche ou les filtres.</b>`
    : html`Aucune entreprise suivie pour l'instant.<br><b>« Ajouter » en crée une, « Découvrir » en propose.</b>`;
}

// Éléments d'une ligne qui peuvent porter le focus clavier et le retrouver après un nouveau rendu
const FOCUS_KEEP = [".rowcheck", ".rowstatut", ".actmail"];

export function renderTable(list = visibleList()) {
  const tbody = $("#tbody");
  // Le rendu remplace toutes les lignes : on note où était le focus pour le rendre à la même entreprise
  const active = tbody.contains(document.activeElement) ? document.activeElement : null;
  const id = active?.closest("tr")?.dataset.id;
  const part = active && FOCUS_KEEP.find(sel => active.matches(sel));
  tbody.innerHTML = html`${list.map(rowHtml)}`;
  if (id && (part || active.matches("tr"))) {
    const tr = tbody.querySelector(`tr[data-id="${Number(id)}"]`);
    (part ? tr?.querySelector(part) : tr)?.focus({ preventScroll: true });
  }
  syncCheckAll(list);
}

function syncCheckAll(list) {
  const vis = list.filter(e => e.email);
  const n = vis.filter(e => selection.has(e.id)).length;
  $("#checkAll").checked = vis.length > 0 && n === vis.length;
  $("#checkAll").indeterminate = n > 0 && n < vis.length;
}

export function renderList() {
  const kanban = view.mode === "kanban";
  $("#tableWrap").hidden = kanban;
  $("#kanban").hidden = !kanban;
  $("#viewToggle").innerHTML = kanban ? html`${icon("list")} Tableau` : html`${icon("columns")} Kanban`;
  const list = visibleList();
  renderEmpty(list);
  if (kanban) renderKanban(list);
  else renderTable(list);
}

function renderSelbar() {
  // Une entreprise supprimée entre-temps (autre onglet, import…) ne reste pas sélectionnée
  for (const id of selection) if (!state.entreprises.some(e => e.id === id)) selection.delete(id);
  const n = selection.size;
  $("#selbar").classList.toggle("show", n > 0);
  $("#selCount").innerHTML = html`<b>${n}</b> sélectionnée${n > 1 ? "s" : ""}`;
}

// Sélection modifiée : seules les lignes concernées, la case « tout » et la barre sont mises à jour.
// Le tableau n'est pas redessiné, la case cochée au clavier garde donc le focus.
export function renderSelection() {
  for (const tr of $$("#tbody tr[data-id]")) {
    const on = selection.has(Number(tr.dataset.id));
    tr.classList.toggle("selected", on);
    tr.querySelector(".rowcheck").checked = on;
  }
  if (view.mode !== "kanban") syncCheckAll(visibleList());
  renderSelbar();
}

function renderTagFilter() {
  const sel = $("#tagFilter");
  if (!sel) return;
  const tags = [...new Set(state.entreprises.flatMap(e => e.tags || []))].sort((a, b) => a.localeCompare(b, "fr"));
  if (filter.tag && !tags.includes(filter.tag)) filter.tag = "";
  sel.hidden = tags.length === 0;
  sel.innerHTML = html`<option value="">Toutes les campagnes / étiquettes</option>${tags.map(t => html`<option value="${t}" ${filter.tag === t ? "selected" : ""}>${t}</option>`)}`;
}

export function renderAll() {
  renderTagFilter();
  renderToday();
  renderStats();
  renderList();
  renderSelbar();
}

function tickClock() {
  const now = new Date();
  $("#clock").textContent =
    now.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" }) + " " +
    now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Rafraîchit l'horloge et les compteurs « il y a … » chaque minute, sauf pendant un glisser-déposer
// ou quand une liste de statut est ouverte dans le tableau (la redessiner la refermerait sous la souris).
export function initClock() {
  tickClock();
  setInterval(() => {
    tickClock();
    if (document.hidden || document.querySelector(".kcard.dragging") || document.activeElement?.matches("#tbody .rowstatut")) return;
    renderToday();
    renderStats();
    renderList();
  }, 60000);
}
