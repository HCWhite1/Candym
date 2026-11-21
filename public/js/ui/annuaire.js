// Annuaire des entreprises (data.gouv) : compléter une fiche (SIREN, adresse, état).
// Découvrir : entreprises d'un secteur dans un département (annuaire), ou offres
// d'alternance et entreprises qui recrutent des alternants (La bonne alternance).
import { api } from "../api.js";
import { state, byId, updateEntreprise, changeStatut } from "../state.js";
import { $, html, toast, safeUrl } from "../utils.js";
import { icon } from "../icons.js";
import { showModal, closeModals } from "./modals.js";
import { renderAll } from "./render.js";

const resultMeta = r => [r.activite, r.effectif && `${r.effectif} salariés`, r.categorie, r.creation && `créée en ${r.creation.slice(0, 4)}`]
  .filter(Boolean).join(" · ");

// Adresse sans le « code postal + ville » final (déjà rangés dans leurs propres champs)
const reEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const streetOf = r => r.adresse.replace(new RegExp(`\\s*${reEsc(r.cp)}\\s+${reEsc(r.ville)}\\s*$`, "i"), "");

const ficheUrl = siren => `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`;

/* ---------- Compléter une fiche ---------- */
let enrichId = null;
let enrichResults = [];

export function openEnrich(id) {
  const e = byId(id);
  if (!e) return;
  enrichId = e.id;
  $("#enNom").textContent = e.nom;
  $("#enQ").value = e.nom;
  $("#enCp").value = e.cp || "";
  $("#enResults").innerHTML = "";
  showModal("#mEnrich");
  searchEnrich();
}

async function searchEnrich() {
  const q = $("#enQ").value.trim();
  if (q.length < 3) { toast("Saisis au moins 3 caractères", "warn"); return; }
  $("#enResults").innerHTML = html`<p class="hint">Recherche dans l'annuaire…</p>`;
  let elargie = false;
  try {
    ({ results: enrichResults, elargie } = await api.annuaire.recherche({ q, cp: $("#enCp").value.trim() }));
  } catch (err) {
    $("#enResults").innerHTML = html`<p class="hint warn">${err.message}</p>`;
    return;
  }
  $("#enResults").innerHTML = enrichResults.length
    ? html`${elargie && html`<p class="hint">Rien avec ce code postal : résultats pour toute la France.</p>`}
      ${enrichResults.map((r, i) => html`
      <div class="annrow">
        <div class="annmain">
          <div><b>${r.nom}</b>${r.enseigne && r.enseigne !== r.nom && html` <span class="muted">(${r.enseigne})</span>`}
            ${r.ouverte ? "" : html`<span class="pill danger">fermée</span>`}</div>
          <div class="muted small">${r.adresse}</div>
          <div class="muted small">${resultMeta(r)} · SIREN <a href="${ficheUrl(r.siren)}" target="_blank" rel="noopener noreferrer">${r.siren}</a></div>
        </div>
        <button class="btn small primary" data-use="${i}">Utiliser</button>
      </div>`)}`
    : html`<p class="hint">Aucun résultat. Essaie un nom plus court ou retire le code postal.</p>`;
}

async function applyEnrich(r) {
  const e = byId(enrichId);
  if (!e) return;
  const overwrite = $("#enOverwrite").checked;
  const patch = { siren: r.siren };
  const set = (key, value) => { if (value && (overwrite || !e[key])) patch[key] = value; };
  set("adresse", streetOf(r));
  set("cp", r.cp);
  set("ville", r.ville);
  set("activite", r.activite);
  try {
    await updateEntreprise(e.id, patch);
    if (!r.ouverte && e.statut !== "fermee"
        && confirm(`${r.nom} est fermée d'après l'annuaire. Passer « ${e.nom} » en « Fermée / abandonnée » ?`)) {
      await changeStatut(byId(e.id), "fermee");
    }
    closeModals();
    renderAll();
    const { openDrawer } = await import("./drawer.js");
    openDrawer(e.id);
    toast("Fiche complétée depuis l'annuaire");
  } catch (err) { toast(err.message, "err"); }
}

/* ---------- Découvrir des entreprises ---------- */
let disc = { page: 1, pages: 1, results: [] };

// Département le plus représenté dans tes entreprises (point de départ de la recherche)
function guessDepartement() {
  const counts = {};
  for (const e of state.entreprises) {
    const d = String(e.cp || "").slice(0, 2);
    if (/^\d{2}$/.test(d)) counts[d] = (counts[d] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

const SOURCE_KEY = "radar.discoverSource";
const source = () => document.querySelector('input[name="diSource"]:checked')?.value || "annuaire";

const BUILTIN_PORTALS = [
  { name: "Welcome to the Jungle", build: (q, loc, c) => `https://www.welcometothejungle.com/fr/jobs?query=${encodeURIComponent([q, c].filter(Boolean).join(" "))}${loc ? `&aroundQuery=${encodeURIComponent(loc)}` : ""}` },
  { name: "LinkedIn",              build: (q, loc, c) => `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent([q, c].filter(Boolean).join(" "))}${loc ? `&location=${encodeURIComponent(loc)}` : ""}` },
  { name: "Indeed",                build: (q, loc, c) => `https://fr.indeed.com/jobs?q=${encodeURIComponent([q, c].filter(Boolean).join(" "))}${loc ? `&l=${encodeURIComponent(loc)}` : ""}` },
  { name: "HelloWork",             build: (q, loc, c) => `https://www.hellowork.com/fr-fr/emploi/recherche.html?k=${encodeURIComponent([q, c].filter(Boolean).join(" "))}${loc ? `&l=${encodeURIComponent(loc)}` : ""}` },
  { name: "France Travail",        build: (q, loc, c) => `https://candidat.francetravail.fr/offres/recherche?motsCles=${encodeURIComponent([q, c].filter(Boolean).join(" "))}${loc ? `&lieux=${encodeURIComponent(loc)}` : ""}` },
  { name: "1jeune1solution",       build: (q, loc, c) => `https://www.1jeune1solution.gouv.fr/stages?motCle=${encodeURIComponent([q, c].filter(Boolean).join(" "))}${loc ? `&localisation=${encodeURIComponent(loc)}` : ""}` },
];

function fillPortalUrl(tpl, q, loc, contrat) {
  return tpl
    .replaceAll("{q}", encodeURIComponent(q))
    .replaceAll("{loc}", encodeURIComponent(loc))
    .replaceAll("{contrat}", encodeURIComponent(contrat));
}

function renderPortals() {
  const box = $("#poList");
  if (!box) return;
  const q = ($("#poQuery")?.value || "").trim();
  const loc = ($("#poLoc")?.value || "").trim();
  const contrat = $("#poContrat")?.value || "";
  const customs = state.settings.customPortals || [];
  box.innerHTML = html`
    ${BUILTIN_PORTALS.map(p => html`
      <a class="portal-card" href="${p.build(q, loc, contrat)}" target="_blank" rel="noopener noreferrer">
        <span>${p.name}</span><span class="p-ext">↗</span>
      </a>`)}
    ${customs.map((p, i) => {
      const href = safeUrl(fillPortalUrl(p.url, q, loc, contrat));
      return html`
      <div class="portal-wrap">
        <a class="portal-card" href="${href || "#"}" target="_blank" rel="noopener noreferrer">
          <span>${p.name}</span><span class="p-ext">↗</span>
        </a>
        <button class="portal-del" type="button" data-del-portal="${i}" title="Supprimer ${p.name}" aria-label="Supprimer ${p.name}">×</button>
      </div>`;
    })}`;
}

function showSource() {
  const current = source();
  for (const el of document.querySelectorAll("#mDiscover [data-source]")) el.hidden = el.dataset.source !== current;
  for (const el of document.querySelectorAll("#mDiscover [data-not-source]")) el.hidden = el.dataset.notSource === current;
  $("#diResults").innerHTML = "";
  try { localStorage.setItem(SOURCE_KEY, current); } catch { /* préférence non conservée */ }
  if (current === "lba") loadLba();
  if (current === "portals") renderPortals();
}

let secteursLoaded = false;
export async function openDiscover() {
  showModal("#mDiscover");
  if (!$("#diDep").value) $("#diDep").value = guessDepartement();
  if (!$("#poLoc").value && $("#diDep").value) $("#poLoc").value = $("#diDep").value;
  let saved = "annuaire";
  try {
    const v = localStorage.getItem(SOURCE_KEY);
    if (v === "lba" || v === "portals") saved = v;
  } catch { /* stockage indisponible */ }
  const radio = document.querySelector(`input[name="diSource"][value="${saved}"]`);
  if (radio) radio.checked = true;
  showSource();
  if (!secteursLoaded) {
    try {
      const naf = await api.annuaire.secteurs();
      const defaults = new Set(["62.01Z", "62.02A", "58.29C"]);
      $("#diNaf").innerHTML = html`${Object.entries(naf).map(([code, label]) => html`
        <label class="checkline"><input type="checkbox" value="${code}" ${defaults.has(code) ? "checked" : ""}> ${label} <span class="muted small">${code}</span></label>`)}`;
      secteursLoaded = true;
    } catch (err) { toast(err.message, "err"); }
  }
}

async function searchDiscover(page = 1) {
  if (source() === "lba") return searchLba();
  const naf = [...document.querySelectorAll("#diNaf input:checked")].map(c => c.value);
  $("#diResults").innerHTML = html`<p class="hint">Recherche dans l'annuaire…</p>`;
  try {
    const r = await api.annuaire.decouvrir({ departement: $("#diDep").value.trim(), naf: naf.join(","), page });
    disc = { page: r.page, pages: r.pages, total: r.total, masquees: r.masquees, results: r.results };
  } catch (err) {
    $("#diResults").innerHTML = html`<p class="hint warn">${err.message}</p>`;
    return;
  }
  renderDiscover();
}

function renderDiscover() {
  const { results, page, pages, total, masquees } = disc;
  $("#diResults").innerHTML = html`
    <p class="hint">${total} entreprise(s) active(s) · page ${page} / ${pages}${masquees > 0 && ` · ${masquees} masquée(s) sur cette page (aucun établissement ouvert dans le département)`}</p>
    ${results.map((r, i) => html`
      <div class="annrow ${r.dejaSuivie ? "known" : ""}">
        <div class="annmain">
          <div><b>${r.enseigne || r.nom}</b>${r.enseigne && r.enseigne !== r.nom && html` <span class="muted small">${r.nom}</span>`}</div>
          <div class="muted small">${r.adresse}</div>
          <div class="muted small">${resultMeta(r)} · <a href="${ficheUrl(r.siren)}" target="_blank" rel="noopener noreferrer">fiche</a></div>
        </div>
        ${r.dejaSuivie ? html`<span class="pill">déjà suivie</span>` : html`<button class="btn small" data-add="${i}">${icon("plus", 13)} Ajouter</button>`}
      </div>`)}
    <div class="btnrow pager">
      <button class="btn small" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>← Précédente</button>
      <button class="btn small" data-page="${page + 1}" ${page >= pages ? "disabled" : ""}>Suivante →</button>
    </div>`;
}

/* ---------- La bonne alternance ---------- */
let lbaLoaded = false;
let lba = { jobs: [], recruiters: [], warnings: [] };
const TELETRAVAIL = { onsite: "sur site", remote: "télétravail", hybrid: "hybride" };
const dateFr = iso => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "");

async function loadLba() {
  try {
    const { configured } = await api.lba.status();
    $("#lbMissing").hidden = configured;
    if (lbaLoaded) return;
    const { metiers, niveaux } = await api.lba.metiers();
    const defaults = new Set(["M1805", "M1810"]);
    $("#lbMetiers").innerHTML = html`${Object.entries(metiers).map(([code, label]) => html`
      <label class="checkline"><input type="checkbox" value="${code}" ${defaults.has(code) ? "checked" : ""}> ${label} <span class="muted small">${code}</span></label>`)}`;
    $("#lbNiveau").innerHTML = html`<option value="">Tous niveaux</option>${Object.entries(niveaux).map(([n, label]) => html`
      <option value="${n}" ${n === "5" ? "selected" : ""}>${label}</option>`)}`;
    lbaLoaded = true;
  } catch (err) { toast(err.message, "err"); }
}

async function searchLba() {
  const romes = [...document.querySelectorAll("#lbMetiers input:checked")].map(c => c.value);
  $("#diResults").innerHTML = html`<p class="hint">Recherche sur La bonne alternance…</p>`;
  try {
    lba = await api.lba.recherche({ departement: $("#diDep").value.trim(), romes: romes.join(","), niveau: $("#lbNiveau").value });
  } catch (err) {
    $("#diResults").innerHTML = html`<p class="hint warn">${err.message}</p>`;
    return;
  }
  renderLba();
}

const jobMeta = j => [
  j.debut && `début ${dateFr(j.debut)}`,
  j.dureeMois && `${j.dureeMois} mois`,
  j.niveau,
  TELETRAVAIL[j.teletravail],
  j.publication && `publiée le ${dateFr(j.publication)}`,
  j.source,
].filter(Boolean).join(" · ");

const place = e => [e.nom, [e.cp, e.ville].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
const addButton = (e, key) => e.dejaSuivie
  ? html`<span class="pill">déjà suivie</span>`
  : html`<button class="btn small" data-lba-add="${key}">${icon("plus", 13)} Ajouter</button>`;
const link = (url, label) => safeUrl(url) && html` · <a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;

function renderLba() {
  const { jobs, recruiters, warnings } = lba;
  $("#diResults").innerHTML = html`
    ${warnings.map(w => html`<p class="hint warn">${w}</p>`)}
    <p class="hint"><b>${jobs.length} offre(s) d'alternance</b></p>
    ${jobs.length ? jobs.map((j, i) => html`
      <div class="annrow ${j.dejaSuivie ? "known" : ""}">
        <div class="annmain">
          <div><b>${j.titre}</b>${j.ecole && html`<span class="pill" title="Offre publiée par une école pour le compte d'une entreprise">via une école</span>`}</div>
          <div class="muted small">${place(j)}</div>
          <div class="muted small">${jobMeta(j)}${link(j.lien, "voir l'offre")}</div>
        </div>
        ${addButton(j, `job:${i}`)}
      </div>`) : html`<p class="hint">Aucune offre pour ces métiers dans ce département.</p>`}
    <p class="hint mt"><b>${recruiters.length} entreprise(s) qui recrutent souvent des alternants</b> · sans offre publiée : candidature spontanée</p>
    ${recruiters.map((r, i) => html`
      <div class="annrow ${r.dejaSuivie ? "known" : ""}">
        <div class="annmain">
          <div><b>${r.nom}</b></div>
          <div class="muted small">${r.adresse}</div>
          <div class="muted small">${[r.activite, r.taille && `${r.taille} salariés`].filter(Boolean).join(" · ")}${link(r.site, "site")}</div>
        </div>
        ${addButton(r, `rec:${i}`)}
      </div>`)}`;
}

function lbaFiche(key) {
  const [kind, index] = key.split(":");
  const e = (kind === "job" ? lba.jobs : lba.recruiters)[Number(index)];
  const note = kind === "job"
    ? `Offre La bonne alternance : « ${e.titre} »${e.debut ? `, début ${dateFr(e.debut)}` : ""}.${e.lien ? `
${e.lien}` : ""}`
    : `Repérée par La bonne alternance : recrute souvent des alternants (candidature spontanée).${e.lien ? `
Postuler : ${e.lien}` : ""}`;
  return {
    nom: e.nom,
    activite: e.activite,
    adresse: e.rue,
    cp: e.cp,
    ville: e.ville,
    siren: e.siren,
    url: e.site,
    tel: e.tel,
    statut: "a_evaluer",
    note: `${note}
Chercher l'email du recruteur.`,
  };
}

export function initAnnuaire({ openEdit }) {
  for (const radio of document.querySelectorAll('input[name="diSource"]')) radio.addEventListener("change", showSource);
  $("#lbOpenSettings").addEventListener("click", () => {
    closeModals();
    $("#btnSettings").click();
    const sec = $("#secLba");
    if (sec) { sec.open = true; sec.scrollIntoView({ block: "nearest" }); }
    $("#s_lba_token")?.focus();
  });
  $("#enSearch").addEventListener("click", searchEnrich);
  $("#enQ").addEventListener("keydown", ev => { if (ev.key === "Enter") searchEnrich(); });
  $("#enResults").addEventListener("click", ev => {
    const b = ev.target.closest("[data-use]");
    if (b) applyEnrich(enrichResults[Number(b.dataset.use)]);
  });

  $("#btnDiscover").addEventListener("click", openDiscover);
  for (const id of ["#poQuery", "#poLoc", "#poContrat"]) {
    $(id)?.addEventListener("input", renderPortals);
    $(id)?.addEventListener("change", renderPortals);
  }
  $("#poAddBtn")?.addEventListener("click", async () => {
    const name = $("#poNewName").value.trim();
    const url = $("#poNewUrl").value.trim();
    if (!name || !/^https?:\/\//i.test(url)) { toast("Nom et URL http(s) requis", "warn"); return; }
    const next = [...(state.settings.customPortals || []), { id: String(Date.now()), name, url }];
    try {
      const s = await api.settings.update({ customPortals: next });
      Object.assign(state.settings, s);
      $("#poNewName").value = "";
      $("#poNewUrl").value = "";
      $("#poAddBox").open = false;
      renderPortals();
      toast(`Source « ${name} » ajoutée`);
    } catch (err) { toast(err.message, "err"); }
  });
  $("#poList")?.addEventListener("click", async ev => {
    const del = ev.target.closest("[data-del-portal]");
    if (!del) return;
    const idx = Number(del.dataset.delPortal);
    const next = (state.settings.customPortals || []).filter((_, i) => i !== idx);
    try {
      const s = await api.settings.update({ customPortals: next });
      Object.assign(state.settings, s);
      renderPortals();
      toast("Source supprimée");
    } catch (err) { toast(err.message, "err"); }
  });
  $("#diSearch").addEventListener("click", () => searchDiscover(1));
  $("#diDep").addEventListener("keydown", ev => { if (ev.key === "Enter") searchDiscover(1); });
  $("#diResults").addEventListener("click", ev => {
    const l = ev.target.closest("[data-lba-add]");
    if (l) {
      const fiche = lbaFiche(l.dataset.lbaAdd);
      closeModals();
      openEdit(null, fiche);
      return;
    }
    const p = ev.target.closest("[data-page]");
    if (p) { searchDiscover(Number(p.dataset.page)); return; }
    const a = ev.target.closest("[data-add]");
    if (!a) return;
    const r = disc.results[Number(a.dataset.add)];
    closeModals();
    openEdit(null, {
      nom: r.enseigne || r.nom,
      activite: r.activite,
      adresse: streetOf(r),
      cp: r.cp,
      ville: r.ville,
      siren: r.siren,
      statut: "a_evaluer",
      note: `Trouvée via l'annuaire (${r.naf}${r.effectif ? `, ${r.effectif} salariés` : ""}). Chercher l'email et le site.`,
    });
  });
}
