-- Odświeżenie taksonomii kategorii GENERAL na podstawie przeglądu historii
-- maili (docs/prompt-claude-code-dashboard-kosztow.md, sekcja 2) — nie
-- zgadywanej na sucho listy. UPDATE (nie usuń+wstaw) tam, gdzie to
-- przemianowanie tej samej kategorii, żeby istniejące wpisy Cost zostały
-- powiązane z tym samym wierszem (zmiana nazwy widoczna wszędzie od razu,
-- patrz sekcja 1.5 spec). WHERE po starej nazwie jest no-opem, jeśli ktoś
-- już ręcznie przemianował kategorię w UI — bezpieczne.

-- "Marketing" -> "Marketing i reklama" (potwierdzone: Google Ads, Facebook/Meta Ads)
UPDATE `cost_categories` SET `name` = 'Marketing i reklama' WHERE `name` = 'Marketing' AND `scope` = 'GENERAL';

-- "Hosting/serwer" -> "Hosting i domeny" (dhosting.pl + kilka domen, często płacone łącznie)
UPDATE `cost_categories` SET `name` = 'Hosting i domeny' WHERE `name` = 'Hosting/serwer' AND `scope` = 'GENERAL';

-- Nowa kategoria: cztery regularne subskrypcje (HubSpot, n8n Cloud, Google
-- Workspace, Microsoft) wcześniej wpadały pod "Inne ogólne" — nieczytelne.
INSERT INTO `cost_categories` (`id`, `name`, `scope`, `updatedAt`)
SELECT UUID(), 'Oprogramowanie i subskrypcje', 'GENERAL', CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `cost_categories` WHERE `name` = 'Oprogramowanie i subskrypcje' AND `scope` = 'GENERAL'
);
