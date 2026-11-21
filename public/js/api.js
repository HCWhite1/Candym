// Client HTTP de l'API locale. Toute réponse non-2xx lève une Error
// dont le message vient du serveur quand il est disponible (err.status, err.data en plus).
async function req(method, url, body) {
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch { /* réponse non-JSON */ }
    throw Object.assign(new Error(data?.error || `Erreur serveur (${res.status})`), { status: res.status, data });
  }
  return res.status === 204 ? null : res.json();
}

const qs = params => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "")).toString();

export const api = {
  entreprises: {
    list: () => req("GET", "/api/entreprises"),
    create: data => req("POST", "/api/entreprises", data),
    update: (id, patch) => req("PUT", `/api/entreprises/${id}`, patch),
    remove: id => req("DELETE", `/api/entreprises/${id}`),
    // entry : { type, moyen?, note?, date?, statut?, reponse?, templateId? } → renvoie l'entreprise à jour
    log: (id, entry) => req("POST", `/api/entreprises/${id}/historique`, entry),
    // Mail envoyé depuis un brouillon : le serveur trace contact ou relance et met le statut à jour
    mailSent: (id, { templateId } = {}) => req("POST", `/api/entreprises/${id}/envoi`, { templateId }),
    doublons: params => req("GET", `/api/entreprises/doublons?${qs(params)}`),
  },
  templates: {
    list: () => req("GET", "/api/templates"),
    create: data => req("POST", "/api/templates", data),
    update: (id, data) => req("PUT", `/api/templates/${id}`, data),
    remove: id => req("DELETE", `/api/templates/${id}`),
  },
  documents: {
    list: () => req("GET", "/api/documents"),
    usage: () => req("GET", "/api/documents/usage"),
    remove: (id, force = false) => req("DELETE", `/api/documents/${id}${force ? "?force=1" : ""}`),
    downloadUrl: id => `/api/documents/${id}/download`,
    previewUrl: id => `/api/documents/${id}/preview`,
    async upload(file) {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: {
          "X-Filename": encodeURIComponent(file.name),
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      });
      if (!res.ok) {
        let data = null;
        try { data = await res.json(); } catch { /* réponse non-JSON (fichier trop gros pour le serveur…) */ }
        throw new Error(`Envoi de « ${file.name} » refusé : ${data?.error || `erreur ${res.status}`}`);
      }
      return res.json();
    },
  },
  settings: {
    get: () => req("GET", "/api/settings"),
    update: data => req("PUT", "/api/settings", data),
    testNotification: () => req("POST", "/api/settings/test-notification"),
  },
  mail: {
    getConfig: () => req("GET", "/api/mail/config"),
    saveConfig: data => req("PUT", "/api/mail/config", data),
    clearConfig: () => req("DELETE", "/api/mail/config"),
    test: () => req("POST", "/api/mail/test"),
    testSmtp: () => req("POST", "/api/mail/test-smtp"),
    check: () => req("POST", "/api/mail/check"),
  },
  outbox: {
    list: () => req("GET", "/api/outbox"),
    // { items: [{ entrepriseId, subject, body }], sendAt?, spacingMinutes?, attachments?, templateId?, allowPlaceholders? }
    enqueue: data => req("POST", "/api/outbox", data),
    testToSelf: data => req("POST", "/api/outbox/test", data),
    cancel: id => req("DELETE", `/api/outbox/${id}`),
    retry: id => req("POST", `/api/outbox/${id}/retry`),
  },
  notifications: {
    list: (limit = 50) => req("GET", `/api/notifications?limit=${limit}`),
    unreadCount: () => req("GET", "/api/notifications/unread-count"),
    update: (id, data) => req("PUT", `/api/notifications/${id}`, data),
    readAll: () => req("POST", "/api/notifications/read-all"),
    remove: id => req("DELETE", `/api/notifications/${id}`),
  },
  annuaire: {
    recherche: params => req("GET", `/api/annuaire/recherche?${qs(params)}`),
    decouvrir: params => req("GET", `/api/annuaire/decouvrir?${qs(params)}`),
    secteurs: () => req("GET", "/api/annuaire/secteurs"),
  },
  lba: {
    status: () => req("GET", "/api/lba/status"),
    saveToken: token => req("PUT", "/api/lba/token", { token }),
    deleteToken: () => req("DELETE", "/api/lba/token"),
    metiers: () => req("GET", "/api/lba/metiers"),
    recherche: params => req("GET", `/api/lba/recherche?${qs(params)}`),
  },
  stats: () => req("GET", "/api/stats"),
  data: {
    importJson: data => req("POST", "/api/import", data),
    resetInfo: () => req("GET", "/api/reset"),
    reset: () => req("POST", "/api/reset"),
  },
};

// Événements temps réel du serveur (notifications, envois). Reconnexion automatique
// par le navigateur ; `onChange(connected)` permet de basculer sur un polling de secours.
export function subscribe(handlers, onChange = () => {}) {
  const es = new EventSource("/api/events");
  for (const [type, fn] of Object.entries(handlers)) {
    es.addEventListener(type, ev => fn(JSON.parse(ev.data || "{}")));
  }
  es.onopen = () => onChange(true);
  es.onerror = () => onChange(false);
  return es;
}
