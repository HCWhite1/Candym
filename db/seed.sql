-- ============================================================
-- Candym — réinitialisation des données (version vierge)
-- Vide les tables entreprises, historique et tags.
-- Les modèles, réglages et documents du coffre sont conservés.
-- ============================================================
BEGIN;
DELETE FROM historique;
DELETE FROM tags;
DELETE FROM entreprises;
COMMIT;
