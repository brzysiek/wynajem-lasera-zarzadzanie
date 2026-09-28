-- AlterTable
ALTER TABLE `clients` ADD COLUMN `transportPriceSince` DATETIME(3) NULL;


-- Dane (wniosek 15): data ostatniej zmiany kwoty transportu z dziennika
-- zmian (bez cofniętych), a bez wpisu — data utworzenia klienta
UPDATE `clients` c
SET c.`transportPriceSince` = COALESCE(
  (SELECT MAX(l.`createdAt`) FROM `change_logs` l
    WHERE l.`entity` = 'CLIENT' AND l.`entityId` = c.`id` AND l.`field` = 'transportPriceNet'
      AND l.`operation` = 'FIELD_CHANGE' AND l.`undoneById` IS NULL),
  c.`createdAt`)
WHERE c.`transportPriceNet` IS NOT NULL;
