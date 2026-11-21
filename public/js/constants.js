// Statuts possibles d'une candidature, avec leur libellé et leur couleur
export const STATUTS = {
  a_evaluer:   { label: "À évaluer",              color: "#8B93A7" },
  a_contacter: { label: "À contacter",            color: "#5B9DFF" },
  contacte:    { label: "Contactée — en attente", color: "#4DD0E1" },
  relancee:    { label: "Relancée — en attente",  color: "#FFB454" },
  piste:       { label: "Piste / Entretien",      color: "#C084FC" },
  acceptee:    { label: "Acceptée",               color: "#3DDC84" },
  refusee:     { label: "Refusée",                color: "#FF6B6B" },
  fermee:      { label: "Fermée / abandonnée",    color: "#6B7280" },
};

export const STATUT_ORDER = ["a_evaluer", "a_contacter", "contacte", "relancee", "piste", "acceptee", "refusee", "fermee"];

export const PERT_ORDER = { haute: 0, moyenne: 1, faible: 2, "": 3 };

// Classe CSS de teinte de fond par statut, pour repérer une ligne au coup d'œil
// (a_evaluer et a_contacter restent sans teinte, comme aujourd'hui)
export const ROW_TINT_CLASS = {
  contacte: "row-contacte",
  relancee: "row-relancee",
  piste: "row-piste",
  acceptee: "row-acceptee",
  refusee: "row-refusee",
  fermee: "row-fermee",
};

// Types de modèle : le bouton « Relancer » ouvre le premier modèle de type relance
export const TEMPLATE_KINDS = {
  candidature: "Candidature",
  relance: "Relance",
  autre: "Autre",
};

// Modes d'envoi (Réglages → Envoi des mails)
export const SEND_MODES = {
  gmail: { label: "Brouillon Gmail (navigateur)", button: "Ouvrir dans Gmail" },
  outlook: { label: "Brouillon Outlook.com (navigateur)", button: "Ouvrir dans Outlook" },
  mailto: { label: "Brouillon dans l'application mail (mailto:)", button: "Ouvrir dans ma messagerie" },
  smtp: { label: "Envoi direct depuis l'app (SMTP)", button: "Envoyer" },
};

// Statuts d'un envoi SMTP
export const OUTBOX_STATUS = {
  pending: { label: "Programmé", cls: "st-pending" },
  sending: { label: "En cours", cls: "st-pending" },
  sent: { label: "Envoyé", cls: "st-sent" },
  failed: { label: "Échec", cls: "st-failed" },
  cancelled: { label: "Annulé", cls: "st-cancelled" },
};
