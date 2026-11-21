// Modal d'ajout / édition d'une entreprise.
import { STATUTS, STATUT_ORDER } from "../constants.js";
import { byId, createEntreprise, updateEntreprise, deleteEntreprise } from "../state.js";
import { api } from "../api.js";
import { $, html, toast, busy } from "../utils.js";
import { renderAll } from "./render.js";
import { showModal, closeModals } from "./modals.js";
import { openDrawer, closeDrawer, openId } from "./drawer.js";

let editId = null;
let prefill = null; // données proposées par l'annuaire (création)

// Champs du formulaire : id de l'input → clé de l'API
const FORM = {
  f_nom: "nom", f_activite: "activite", f_ville: "ville", f_cp: "cp", f_adresse: "adresse",
  f_email: "email", f_tel: "tel", f_url: "url", f_pertinence: "pertinence", f_pertnote: "pertinenceNote",
  f_statut: "statut", f_note: "note", f_contact_nom: "contactNom", f_contact_poste: "contactPoste",
  f_entretien: "dateEntretien",
};

// id : entreprise à modifier ; sinon création (éventuellement pré-remplie : { nom, ville, … })
export function openEdit(id, initial = null) {
  editId = id ? Number(id) : null;
  prefill = initial;
  const e = editId ? byId(editId) : initial;
  if (editId && !e) { toast("Cette entreprise n'existe plus", "err"); return; }
  $("#mEditTitle").textContent = editId ? `Modifier « ${e.nom} »` : "Ajouter une entreprise";
  $("#f_statut").innerHTML = html`${STATUT_ORDER.map(k => html`<option value="${k}">${STATUTS[k].label}</option>`)}`;
  for (const [input, key] of Object.entries(FORM)) $("#" + input).value = e?.[key] ?? "";
  if (!e?.statut) $("#f_statut").value = "a_contacter";
  $("#f_delete").hidden = !editId;
  showModal("#mEdit");
  $("#f_nom").focus();
}

function readForm() {
  const vals = {};
  for (const [input, key] of Object.entries(FORM)) {
    const v = $("#" + input).value;
    vals[key] = key === "note" ? v : v.trim();
  }
  return vals;
}

export function initEdit() {
  $("#btnAdd").addEventListener("click", () => openEdit(null));

  const save = () => {
    const vals = readForm();
    if (!vals.nom) { toast("Le nom est obligatoire", "err"); $("#f_nom").focus(); return; }
    if (vals.email && !$("#f_email").checkValidity()) { toast("Adresse email invalide", "err"); $("#f_email").focus(); return; }
    return busy($("#f_save"), async () => {
      if (editId) {
        await updateEntreprise(editId, vals);
        toast("Entreprise mise à jour");
      } else {
        if (prefill?.siren) vals.siren = prefill.siren;
        const dups = await api.entreprises.doublons({ nom: vals.nom, email: vals.email, siren: vals.siren });
        if (dups.length && !confirm(`Entreprise(s) déjà suivie(s) qui semblent correspondre :\n\n${dups.map(d => `• ${d.nom}${d.email ? ` (${d.email})` : ""}`).join("\n")}\n\nAjouter quand même ?`)) return;
        await createEntreprise(vals);
        toast("Entreprise ajoutée");
      }
      closeModals();
      renderAll();
      if (editId && openId === editId) openDrawer(editId);
    });
  };
  $("#f_save").addEventListener("click", save);
  // Entrée dans un champ d'une ligne enregistre (pas dans les notes, où elle va à la ligne)
  $("#mEdit").addEventListener("keydown", ev => {
    if (ev.key === "Enter" && ev.target.matches("input")) { ev.preventDefault(); save(); }
  });

  $("#f_delete").addEventListener("click", () => {
    const e = byId(editId);
    if (!e || !confirm(`Supprimer « ${e.nom} » et tout son historique ?`)) return;
    busy($("#f_delete"), async () => {
      await deleteEntreprise(editId);
      closeModals();
      closeDrawer();
      renderAll();
      toast("Entreprise supprimée");
    });
  });
}
