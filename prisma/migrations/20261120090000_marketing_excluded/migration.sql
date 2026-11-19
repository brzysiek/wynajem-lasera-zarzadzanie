-- AlterTable
ALTER TABLE `clients` ADD COLUMN `marketingExcluded` BOOLEAN NULL,
    ADD COLUMN `marketingExcludedReason` VARCHAR(191) NULL;

-- Dostawca (renowacja głowic), nie klient — nie liczy się w zakładce Marketing (wniosek 54, etap 1c).
UPDATE `clients` SET `marketingExcluded` = 1, `marketingExcludedReason` = 'dostawca (renowacja urządzeń)' WHERE LOWER(`name`) LIKE '%laserprostudio%';
