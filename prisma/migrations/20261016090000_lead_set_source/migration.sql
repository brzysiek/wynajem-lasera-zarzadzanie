-- AlterTable
ALTER TABLE `leads` ADD COLUMN `stageSource` VARCHAR(24) NULL,
    ADD COLUMN `stageSourceAt` DATETIME(3) NULL,
    ADD COLUMN `stageSourceById` VARCHAR(191) NULL,
    ADD COLUMN `stepSource` VARCHAR(24) NULL,
    ADD COLUMN `stepSourceAt` DATETIME(3) NULL,
    ADD COLUMN `stepSourceById` VARCHAR(191) NULL;


-- Uzupełnienie historii tylko tam, gdzie źródło jest pewne i nikt z biura nie ruszał sygnału
-- Lista „Wracają z wiosny”: sygnały założone z listy, bez żadnego wpisu osoby
UPDATE `leads` SET `stageSource` = 'AUTO_SPRING', `stageSourceAt` = `stageChangedAt`, `stepSource` = 'AUTO_SPRING', `stepSourceAt` = `createdAt`
WHERE `sourceRef` LIKE 'wiosna:%' AND `stageSource` IS NULL
  AND NOT EXISTS (SELECT 1 FROM `lead_activities` a WHERE a.`leadId` = `leads`.`id` AND a.`userId` IS NOT NULL);

-- Formularz WWW: nietknięte sygnały (etap Nowe, bez wpisu osoby)
UPDATE `leads` SET `stageSource` = 'AUTO_FORM', `stageSourceAt` = `createdAt`, `stepSource` = 'AUTO_FORM', `stepSourceAt` = `createdAt`
WHERE `origin` = 'WWW' AND `stage` = 'SYGNAL' AND `stageSource` IS NULL
  AND NOT EXISTS (SELECT 1 FROM `lead_activities` a WHERE a.`leadId` = `leads`.`id` AND a.`userId` IS NOT NULL);
