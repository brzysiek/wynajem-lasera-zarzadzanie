-- Wniosek 24: dopasowanie po samej nazwie z wynikiem < 1,0 nie przypisuje
-- automatycznie (Beauty Wood dostała 14 cudzych wynajmów przez słowo
-- „Beauty”). Dotychczasowe takie przypisania (bez decyzji biura) → „do
-- potwierdzenia” (SUGGESTED) — poprzedni klient zostaje pierwszym
-- kandydatem, jedno kliknięcie w Klienci → Dopasowania. Wpis w dzienniku
INSERT INTO `change_logs` (`id`, `createdAt`, `clientId`, `clientName`, `entity`, `entityId`, `operation`, `field`, `before`, `after`, `source`)
SELECT UUID(), UTC_TIMESTAMP(3), h.`clientId`, c.`name`, 'HISTORY', h.`id`, 'MATCH_RESET', 'clientId', CONCAT('"', h.`clientId`, '"'), 'null',
  CONCAT('wniosek 24: dopasowanie po nazwie ', h.`matchScore`, ' < 1,0 → do potwierdzenia („', LEFT(h.`title`, 80), '”)')
FROM `rental_history` h LEFT JOIN `clients` c ON c.`id` = h.`clientId`
WHERE h.`matchState` = 'AUTO' AND h.`matchMethod` = 'NAME_AUTO' AND h.`matchScore` < 1 AND h.`matchedByUserId` IS NULL;

UPDATE `rental_history`
SET `candidates` = COALESCE(`candidates`, JSON_ARRAY(JSON_OBJECT('clientId', `clientId`, 'score', `matchScore`))),
  `clientId` = NULL, `matchMethod` = NULL, `matchState` = 'SUGGESTED'
WHERE `matchState` = 'AUTO' AND `matchMethod` = 'NAME_AUTO' AND `matchScore` < 1 AND `matchedByUserId` IS NULL;

INSERT INTO `change_logs` (`id`, `createdAt`, `clientId`, `clientName`, `entity`, `entityId`, `operation`, `field`, `before`, `after`, `source`)
SELECT UUID(), UTC_TIMESTAMP(3), i.`clientId`, c.`name`, 'INVOICE', i.`id`, 'MATCH_RESET', 'clientId', CONCAT('"', i.`clientId`, '"'), 'null',
  CONCAT('wniosek 24: faktura dopasowana po nazwie ', i.`matchScore`, ' < 1,0 → do potwierdzenia (', i.`number`, ')')
FROM `client_invoices` i LEFT JOIN `clients` c ON c.`id` = i.`clientId`
WHERE i.`matchState` = 'AUTO' AND i.`matchMethod` = 'NAME_AUTO' AND i.`matchScore` < 1 AND i.`matchedByUserId` IS NULL;

UPDATE `client_invoices`
SET `candidates` = COALESCE(`candidates`, JSON_ARRAY(JSON_OBJECT('clientId', `clientId`, 'score', `matchScore`))),
  `clientId` = NULL, `matchMethod` = NULL, `matchState` = 'SUGGESTED'
WHERE `matchState` = 'AUTO' AND `matchMethod` = 'NAME_AUTO' AND `matchScore` < 1 AND `matchedByUserId` IS NULL;
