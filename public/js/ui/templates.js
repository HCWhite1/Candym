// Gestion des modèles de message.
import { api } from "../api.js";
import { TEMPLATE_KINDS } from "../constants.js";
import { state } from "../state.js";
import { $, html, toast, busy } from "../utils.js";
import { icon } from "../icons.js";
import { showModal } from "./modals.js";

let tplEditId = null;

export function openTplManager() {
  renderTplList();
  $("#tplEditor").hidden = true;
  showModal("#mTpl");
}

function renderTplList() {
  $("#tplList").innerHTML = state.templates.length
    ? html`${state.templates.map(t => html`
      <div class="tpl-row">
        <span class="tname">${t.name}</span>
        <span class="pill kind-${t.kind}">${TEMPLATE_KINDS[t.kind] || "Autre"}</span>
        <span class="hint ellipsis">${t.subject}</span>
        <button class="btn small" data-tedit="${t.id}">Modifier</button>
        <button class="btn small danger" data-tdel="${t.id}" title="Supprimer ${t.name}" aria-label="Supprimer ${t.name}">${icon("trash", 13)}</button>
      </div>`)}`
    : html`<p class="hint">Aucun modèle.</p>`;
}

function openTplEditor(id) {
  tplEditId = id || null;
  const t = id ? state.templates.find(x => x.id === id) : null;
  $("#t_name").value = t?.name || "";
  $("#t_kind").value = t?.kind || "candidature";
  $("#t_subject").value = t?.subject || "";
  $("#t_body").value = t?.body || "";
  $("#tplEditor").hidden = false;
  $("#t_name").focus();
}

export function initTemplates() {
  $("#t_kind").innerHTML = html`${Object.entries(TEMPLATE_KINDS).map(([k, l]) => html`<option value="${k}">${l}</option>`)}`;
  $("#btnTpl").addEventListener("click", openTplManager);
  $("#tplAdd").addEventListener("click", () => openTplEditor(null));
  $("#t_cancel").addEventListener("click", () => { $("#tplEditor").hidden = true; });

  $("#tplList").addEventListener("click", async ev => {
    const edit = ev.target.closest("[data-tedit]");
    if (edit) { openTplEditor(Number(edit.dataset.tedit)); return; }
    const del = ev.target.closest("[data-tdel]");
    if (!del) return;
    const id = Number(del.dataset.tdel);
    const t = state.templates.find(x => x.id === id);
    if (!t || !confirm(`Supprimer le modèle « ${t.name} » ?`)) return;
    try {
      await api.templates.remove(id);
      state.templates = state.templates.filter(x => x.id !== id);
      renderTplList();
    } catch (err) { toast(err.message, "err"); }
  });

  $("#t_save").addEventListener("click", () => {
    const name = $("#t_name").value.trim();
    if (!name) { toast("Donne un nom au modèle", "err"); return; }
    const data = { name, kind: $("#t_kind").value, subject: $("#t_subject").value, body: $("#t_body").value };
    busy($("#t_save"), async () => {
      if (tplEditId) {
        const updated = await api.templates.update(tplEditId, data);
        Object.assign(state.templates.find(x => x.id === tplEditId), updated);
      } else {
        state.templates.push(await api.templates.create(data));
      }
      renderTplList();
      $("#tplEditor").hidden = true;
      toast("Modèle enregistré");
    });
  });
}
