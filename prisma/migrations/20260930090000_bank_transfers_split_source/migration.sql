-- AlterTable
ALTER TABLE `fakturownia_payments` ADD COLUMN `bankTransferId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `bank_statement_uploads` ADD COLUMN `periodFrom` DATETIME(3) NULL,
    ADD COLUMN `periodTo` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `bank_transfers` (
    `id` VARCHAR(191) NOT NULL,
    `uploadId` VARCHAR(191) NULL,
    `bookedAt` DATETIME(3) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `description` TEXT NOT NULL,
    `hash` VARCHAR(64) NOT NULL,
    `fakturowniaInvoiceId` INTEGER NULL,
    `matchState` VARCHAR(12) NOT NULL DEFAULT 'NONE',
    `candidates` JSON NULL,
    `matchedByUserId` VARCHAR(191) NULL,
    `matchedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `bank_transfers_hash_key`(`hash`),
    INDEX `bank_transfers_bookedAt_idx`(`bookedAt`),
    INDEX `bank_transfers_fakturowniaInvoiceId_idx`(`fakturowniaInvoiceId`),
    INDEX `bank_transfers_matchState_idx`(`matchState`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- Klienci utworzeni przez „Wydziel do nowego klienta” dostawali źródło
-- zlepka (np. MiWiNi: FORMULARZ_WWW po „Joannie Bakalarz”). Czyścimy je
-- z wpisem w dzienniku (poprawka systemowa, bez autora).
INSERT INTO `change_logs` (`id`, `createdAt`, `clientId`, `clientName`, `entity`, `entityId`, `operation`, `field`, `before`, `after`, `source`)
SELECT UUID(), CURRENT_TIMESTAMP(3), c.`id`, c.`name`, 'CLIENT', c.`id`, 'FIELD_CHANGE', 'source', JSON_QUOTE(c.`source`), 'null',
       'Poprawka: wydzielony klient nie dziedziczy źródła zlepka'
FROM `clients` c
WHERE c.`source` IS NOT NULL
  AND EXISTS (SELECT 1 FROM `change_logs` l WHERE l.`entity` = 'CLIENT' AND l.`entityId` = c.`id` AND l.`operation` = 'SPLIT' AND l.`before` LIKE '{"z":%');

UPDATE `clients` c
SET c.`source` = NULL, c.`legacyHubspotTag` = NULL
WHERE EXISTS (SELECT 1 FROM `change_logs` l WHERE l.`entity` = 'CLIENT' AND l.`entityId` = c.`id` AND l.`operation` = 'SPLIT' AND l.`before` LIKE '{"z":%');
