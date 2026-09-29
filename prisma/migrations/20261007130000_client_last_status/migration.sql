-- AlterTable
ALTER TABLE `clients` ADD COLUMN `lastStatus` VARCHAR(16) NULL;


-- Wniosek 20: przeliczenie wszystkich klientów nową regułą (przyjazdy zamiast
-- wynajmów w 12 mies.) na danych z 29.09 — jedna zmiana. Wpis do dziennika
-- (przed → po). Kolejne zmiany zapisuje codzienny cron historii
INSERT INTO `change_logs` (`id`, `createdAt`, `clientId`, `clientName`, `entity`, `entityId`, `operation`, `field`, `before`, `after`, `source`)
SELECT UUID(), UTC_TIMESTAMP(3), c.`id`, c.`name`, 'CLIENT', c.`id`, 'STATUS_CHANGE', 'status', '"USPIONY"', '"STALY"',
  'automatycznie: wniosek 20 — status z przyjazdów (9 przyjazdów, ostatni 13.04.2026)'
FROM `clients` c WHERE c.`id` = 'cmuhfo9dr008rbhip925tj8ux';
