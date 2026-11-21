// Règles communes au navigateur et au serveur (src/smtp.js importe ce fichier) :
// ni DOM ni Node ici, pour que les deux côtés appliquent exactement la même règle.

// Premier trou « [à compléter] » restant dans un texte, ou null.
export const findPlaceholder = text => String(text || "").match(/\[[^\]\n]{2,40}\]/)?.[0] || null;
