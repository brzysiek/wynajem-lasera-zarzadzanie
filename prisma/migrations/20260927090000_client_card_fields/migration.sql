-- AlterTable
ALTER TABLE `client_contacts` ADD COLUMN `phone2` VARCHAR(191) NULL,
    ADD COLUMN `phone2Label` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `client_invoices` ADD COLUMN `paymentTo` DATETIME(3) NULL,
    ADD COLUMN `paymentType` VARCHAR(191) NULL;

