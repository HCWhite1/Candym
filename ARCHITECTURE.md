# Architecture & documentation technique — Candym

Retour au **[README principal](README.md)**.

## Stack technique

- **Back-end** : Node.js ≥ 22.5, Express 5, SQLite natif (`node:sqlite`, aucune compilation native), `imapflow` + `mailparser` (relève IMAP), `nodemailer` (file d'envoi SMTP), `@napi-rs/keyring` (Gestionnaire d'identifiants Windows).
- **Front-end** : HTML5, CSS3, modules ES natifs sans étape de build, flux temps réel via Server-Sent Events (`/api/events`).
- **Tests** : `node:test` (49 tests unitaires et d'intégration avec serveur HTTP/SQLite temporaire et serveur SMTP local simulé).

## Structure du projet

```text
├── package.json
├── start.bat               # Lancement rapide sous Windows
├── db/
│   ├── schema.sql          # Schéma SQLite
│   ├── defaults.sql        # Modèles et réglages initiaux
│   ├── seed.sql            # Jeu de données initial (vierge par défaut)
│   ├── radar.db            # Base locale (non versionnée) + backups/
│   └── coffre/             # Fichiers joints dédupliqués par SHA-256 (non versionnés)
├── src/
│   ├── server.js           # Serveur Express, middlewares et arrêt propre
│   ├── db.js               # Connexion SQLite, migrations numérotées et sauvegardes
│   ├── coffre.js           # Stockage de fichiers adressés par empreinte SHA-256
│   ├── security.js         # Filtrage Host, anti-CSRF (Sec-Fetch-Site / Origin), CSP
│   ├── secrets.js          # Accès au Gestionnaire d'identifiants Windows
│   ├── mail.js             # Configuration et relève périodique IMAP
│   ├── mail/classify.js    # Rapprochement expéditeur ↔ entreprise et classification
│   ├── smtp.js             # File d'envoi SMTP (programmation, espacement, retries)
│   ├── notify.js           # Notifications Windows et rappels quotidiens
│   ├── events.js           # Diffusion SSE vers le navigateur
│   └── routes/             # Routes REST modulaires
├── public/
│   ├── index.html
│   ├── css/styles.css
│   └── js/                 # État, client API/SSE, utilitaires et modules UI
└── tests/                  # Suite de tests automatisés (node --test)
```

## Sécurité

- **Écoute locale stricte** : le serveur n'écoute que sur `127.0.0.1` et vérifie l'en-tête `Host` (protection contre le *DNS rebinding*).
- **Protection CSRF & quotas** : toutes les requêtes d'écriture ainsi que les routes déclenchant des appels externes (`/api/lba/`, `/api/annuaire/`, `/api/mail/`) vérifient `Sec-Fetch-Site` et `Origin`.
- **Secrets hors base** : le mot de passe mail et le jeton *La bonne alternance* sont stockés dans le **Gestionnaire d'identifiants Windows**, jamais dans SQLite ni dans les exports/sauvegardes, et ne sont jamais renvoyés par l'API. Tout changement de serveur ou d'adresse efface automatiquement le mot de passe enregistré.
- **CSP & échappement** : `Content-Security-Policy` stricte (aucun script inline ni ressource externe), gabarit `html` échappé par défaut côté client, validation des schémas d'URL (`http(s)` uniquement) et protection contre l'injection de formules dans l'export CSV.

## Stockage, coffre & sauvegardes

- **Base et migrations** : créée au premier lancement depuis `db/schema.sql` et `db/defaults.sql`. Les évolutions de schéma sont gérées par migrations numérotées (`PRAGMA user_version`) avec sauvegarde automatique préalable dans `db/backups/` (conservation des 5 dernières copies).
- **Coffre dédupliqué** : les documents déposés dans le coffre sont stockés dans `db/coffre/` sous leur empreinte SHA-256 (limite : 25 Mo par fichier, 2 Go au total). Un fichier référencé par la base active ou par une sauvegarde est préservé lors du nettoyage.

## API REST & SSE

| Méthode | Route | Rôle |
|---|---|---|
| `GET` / `POST` | `/api/entreprises` | Liste (avec historique et étiquettes) / création |
| `PUT` / `DELETE` | `/api/entreprises/:id` | Mise à jour partielle / suppression |
| `GET` | `/api/entreprises/doublons` | Détection de doublons (`nom`, `email`, `siren`) |
| `POST` | `/api/entreprises/:id/historique` | Journalisation d'un échange |
| `POST` | `/api/entreprises/:id/envoi` | Traçage d'un mail envoyé depuis un brouillon |
| `GET` / `POST` / `PUT` / `DELETE` | `/api/templates` · `/:id` | Gestion des modèles de message |
| `GET` / `POST` / `DELETE` | `/api/documents` · `/:id/download` | Coffre à documents et statistiques d'espace (`/usage`) |
| `GET` / `PUT` | `/api/settings` | Réglages généraux et portails d'offres personnalisés |
| `GET` / `PUT` / `DELETE` | `/api/mail/config` | Configuration IMAP / SMTP |
| `POST` | `/api/mail/test` · `/test-smtp` · `/check` | Tests de connexion et relève IMAP immédiate |
| `GET` / `POST` / `DELETE` | `/api/outbox` · `/:id` · `/:id/retry` | File d'envoi SMTP programmée |
| `GET` / `PUT` / `POST` / `DELETE` | `/api/notifications` · `/read-all` | Notifications de réponses détectées |
| `GET` | `/api/annuaire/recherche` · `/decouvrir` · `/secteurs` | Relais API Recherche d'entreprises (`data.gouv.fr`) |
| `GET` / `PUT` / `DELETE` | `/api/lba/status` · `/token` · `/metiers` · `/recherche` | Intégration API *La bonne alternance* |
| `GET` | `/api/stats` · `/api/events` | Statistiques agrégées et flux SSE temps réel |
| `POST` / `GET` | `/api/import` · `/api/reset` | Import JSON et réinitialisation |

## Tests

```bash
npm test
```

Exécute les 49 tests automatisés (`tests/classify.test.js`, `tests/utils.test.js`, `tests/backup.test.js`, `tests/coffre.test.js`, `tests/imap.test.js`, `tests/server.test.js`) sur une base temporaire isolée, sans toucher à `db/radar.db`.
