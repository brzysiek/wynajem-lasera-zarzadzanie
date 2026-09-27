-- AlterTable
ALTER TABLE `leads` ADD COLUMN `attempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `followUpNo` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `lastContactAt` DATETIME(3) NULL,
    ADD COLUMN `nextStepNote` TEXT NULL,
    ADD COLUMN `nextStepType` VARCHAR(20) NULL,
    ADD COLUMN `sourceRef` VARCHAR(191) NULL,
    MODIFY `type` ENUM('POBRANIE_CENNIKA', 'KONTAKT', 'REZERWACJA_WWW', 'SZKOLENIE_WWW', 'TELEFON', 'EMAIL', 'OLX', 'POLECENIE', 'INNE') NOT NULL,
    MODIFY `lostReason` ENUM('CENA', 'TERMIN_ZAJETY', 'ODLEGLOSC', 'KUPILA_URZADZENIE', 'INNE_URZADZENIE', 'BRAK_KONTAKTU', 'TYLKO_CENNIK', 'POZA_BRANZA', 'ARCHIWUM_IMPORTU', 'INNE') NULL;


-- Lejek (wniosek 18, etap L1) — dane jednorazowo.
-- 1) Każdy otwarty sygnał ma osobę prowadzącą: domyślnie Ania.
UPDATE `leads`
SET `ownerId` = (SELECT `id` FROM `users` WHERE `name` = 'Ania' AND `role` IN ('ADMIN', 'STAFF') ORDER BY `createdAt` LIMIT 1)
WHERE `ownerId` IS NULL AND `archivedAt` IS NULL AND `stage` IN ('SYGNAL', 'WYWIAD', 'OFERTA', 'REZERWACJA');

-- 2) Ostatni kontakt = pierwszy znany kontakt (do czasu kolejnych wpisów).
UPDATE `leads` SET `lastContactAt` = `firstContactAt` WHERE `lastContactAt` IS NULL AND `firstContactAt` IS NOT NULL;

-- 3) Otwarte sygnały z 2026 bez kontaktu → pierwszy kontakt dziś (lista „Do obdzwonienia”).
UPDATE `leads`
SET `nextActionAt` = CURRENT_TIMESTAMP(3), `nextStepType` = 'PIERWSZY_KONTAKT'
WHERE `archivedAt` IS NULL AND `stage` IN ('SYGNAL', 'WYWIAD', 'OFERTA', 'REZERWACJA')
  AND `firstContactAt` IS NULL AND `nextActionAt` IS NULL AND `createdAt` >= '2025-12-31 23:00:00';

-- 4) Oferty z 2026 bez następnego kroku → follow-up najbliższego dnia roboczego, 10:00 (08:00 UTC).
UPDATE `leads`
SET `nextActionAt` = TIMESTAMP(DATE_ADD(UTC_DATE(), INTERVAL CASE DAYOFWEEK(UTC_DATE()) WHEN 6 THEN 3 WHEN 7 THEN 2 ELSE 1 END DAY), '08:00:00'),
    `nextStepType` = 'FOLLOW_UP_OFERTY', `followUpNo` = 1
WHERE `archivedAt` IS NULL AND `stage` = 'OFERTA' AND `nextActionAt` IS NULL AND `createdAt` >= '2025-12-31 23:00:00';
