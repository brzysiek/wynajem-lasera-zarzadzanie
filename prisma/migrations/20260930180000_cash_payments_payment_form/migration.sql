-- AlterTable
ALTER TABLE `fakturownia_payments` ADD COLUMN `markedById` VARCHAR(191) NULL,
    ADD COLUMN `method` VARCHAR(12) NULL,
    ADD COLUMN `note` TEXT NULL,
    ADD COLUMN `receivedBy` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `clients` ADD COLUMN `paymentForm` VARCHAR(12) NULL;


-- Istniejące wpisy: z przelewem z wyciągu = TRANSFER, reszta = MANUAL.
UPDATE `fakturownia_payments` SET `method` = IF(`bankTransferId` IS NULL, 'MANUAL', 'TRANSFER') WHERE `method` IS NULL;
