// Coffre à documents (CV, lettres…) — fichiers rangés côté serveur dans db/coffre/.

const MAX_FILE_MB = 25; // même limite que le serveur (src/routes/documents.js)
import { api } from "../api.js";
import { $, $$, html, toast, fmtSize } from "../utils.js";
import { icon } from "../icons.js";
import { showModal } from "./modals.js";

// Même règle que le serveur (previewType, src/routes/documents.js) : PDF et images matricielles.
const PREVIEW_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"];
const PREVIEW_EXT = /\.(pdf|png|jpe?g|gif|webp)$/i;
export const canPreview = d => PREVIEW_TYPES.includes(d.type) || PREVIEW_EXT.test(d.name);
const isPdf = d => d.type === "application/pdf" || /\.pdf$/i.test(d.name);

// variant : "manage" (aperçu + télécharger + supprimer), "download" (télécharger), "inline" (nom et taille seuls)
export function docRowHtml(d, variant = "manage") {
  const inner = html`<span class="muted lh0">${icon("file", 17)}</span><span class="dname">${d.name}</span><span class="dsize">${fmtSize(d.size)}</span>`;
  if (variant === "inline") return inner;
  return html`<div class="docrow" data-doc="${d.id}">
    ${inner}
    ${variant === "manage" && canPreview(d) && html`<button class="btn small" data-dview="${d.id}" title="Aperçu de ${d.name}" aria-label="Aperçu de ${d.name}" aria-expanded="false">${icon("eye", 13)}</button>`}
    <a class="btn small" href="${api.documents.downloadUrl(d.id)}">${icon("download", 13)} Télécharger</a>
    ${variant === "manage" && html`<button class="btn small danger" data-ddel="${d.id}" title="Supprimer ${d.name}" aria-label="Supprimer ${d.name}">${icon("trash", 13)}</button>`}
  </div>`;
}

export async function refreshVaultCount() {
  try {
    const docs = await api.documents.list();
    $("#vaultCount").textContent = docs.length ? "(" + docs.length + ")" : "";
    return docs;
  } catch { return []; }
}

let vaultDocs = [];
let previewId = null; // document affiché dans le panneau d'aperçu

async function renderVault() {
  const [docs] = await Promise.all([refreshVaultCount(), renderUsage()]);
  vaultDocs = docs;
  $("#docList").innerHTML = docs.length
    ? html`${docs.map(d => docRowHtml(d))}`
    : html`<p class="hint">Coffre vide — dépose ici ton CV et tes lettres.</p>`;
  showPreview(docs.find(d => d.id === previewId) || null);
}

// Panneau d'aperçu sous la liste : iframe pour un PDF (visionneuse du navigateur), <img> pour une image.
function showPreview(doc) {
  previewId = doc?.id ?? null;
  const box = $("#docPreview");
  $("#mVault .mbox").classList.toggle("xwide", !!doc);
  for (const b of $$("#docList [data-dview]")) b.setAttribute("aria-expanded", String(Number(b.dataset.dview) === previewId));
  if (!doc) { box.hidden = true; box.innerHTML = ""; return; }
  const url = api.documents.previewUrl(doc.id);
  box.innerHTML = html`
    <div class="dphead">
      <span class="dname">${doc.name}</span>
      <a class="btn small" href="${url}" target="_blank" rel="noopener">Ouvrir dans un onglet</a>
      <button class="iconbtn" data-dpclose aria-label="Fermer l'aperçu">${icon("x", 16)}</button>
    </div>
    ${isPdf(doc)
      ? html`<iframe class="dpframe" src="${url}" title="Aperçu de ${doc.name}"></iframe>`
      : html`<div class="dpimg"><img src="${url}" alt="Aperçu de ${doc.name}"></div>`}`;
  box.hidden = false;
  box.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// Place sur le disque : base, fichiers du coffre (une seule copie, sauvegardes comprises) et sauvegardes de la base.
async function renderUsage() {
  let u;
  try { u = await api.documents.usage(); } catch { $("#vaultUsage").innerHTML = ""; return; }
  const { backups } = u;
  $("#vaultUsage").innerHTML = html`
    <div class="kpi"><span class="klabel">Espace total</span><b>${fmtSize(u.dbBytes + u.coffreBytes + backups.bytes)}</b><small>base ${fmtSize(u.dbBytes)} · fichiers ${fmtSize(u.coffreBytes)}</small></div>
    <div class="kpi"><span class="klabel">Coffre</span><b>${fmtSize(u.vaultBytes)}</b><small>sur ${fmtSize(u.vaultMaxBytes)} autorisés</small></div>
    <div class="kpi" title="Copies de la base faites avant un import, une réinitialisation ou une mise à jour (dossier db/backups). Elles ne recopient pas les fichiers du coffre.">
      <span class="klabel">Sauvegardes</span><b>${fmtSize(backups.bytes)}</b><small>${backups.count} copie${backups.count > 1 ? "s" : ""} · ${backups.kept} gardées au plus</small></div>`;
}

async function removeDoc(id) {
  if (!confirm("Supprimer ce document du coffre ?")) return;
  try {
    await api.documents.remove(id);
  } catch (err) {
    if (err.status !== 409) throw err;
    if (!confirm(`${err.message}. Ces envois échoueront faute de pièce jointe. Supprimer quand même ?`)) return;
    await api.documents.remove(id, true);
  }
  toast("Document supprimé");
}

export function openVault() {
  previewId = null; // la modale rouvre toujours sur la liste seule
  renderVault();
  showModal("#mVault");
}

export function initVault() {
  $("#btnVault").addEventListener("click", openVault);

  $("#docList").addEventListener("click", ev => {
    const v = ev.target.closest("[data-dview]");
    if (!v) return;
    const id = Number(v.dataset.dview);
    showPreview(id === previewId ? null : vaultDocs.find(d => d.id === id) || null);
  });
  $("#docPreview").addEventListener("click", ev => {
    if (ev.target.closest("[data-dpclose]")) showPreview(null);
  });

  $("#docList").addEventListener("click", async ev => {
    const b = ev.target.closest("[data-ddel]");
    if (!b) return;
    try {
      await removeDoc(Number(b.dataset.ddel));
      renderVault();
    } catch (err) { toast(err.message, "err"); }
  });

  $("#docInput").addEventListener("change", async ev => {
    let added = 0;
    for (const f of ev.target.files) {
      if (f.size > MAX_FILE_MB * 1048576) { toast(`« ${f.name} » dépasse ${MAX_FILE_MB} Mo, ignoré`, "warn"); continue; }
      try { await api.documents.upload(f); added++; }
      catch (err) { toast(err.message, "err"); }
    }
    ev.target.value = "";
    renderVault();
    if (added) toast(added > 1 ? `${added} documents ajoutés au coffre` : "Document ajouté au coffre");
  });

  refreshVaultCount();
}
