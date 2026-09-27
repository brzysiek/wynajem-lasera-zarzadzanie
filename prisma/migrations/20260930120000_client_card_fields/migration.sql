-- AlterTable
ALTER TABLE `clients` ADD COLUMN `agreedPrice` DECIMAL(10, 2) NULL,
    ADD COLUMN `bankAccounts` JSON NULL,
    ADD COLUMN `businessStartDate` DATETIME(3) NULL,
    ADD COLUMN `deliveryAddress` TEXT NULL,
    ADD COLUMN `deliveryNotes` JSON NULL,
    ADD COLUMN `enrichedAt` DATETIME(3) NULL,
    ADD COLUMN `fieldMeta` JSON NULL,
    ADD COLUMN `frameAgreement` JSON NULL,
    ADD COLUMN `googleReview` JSON NULL,
    ADD COLUMN `invoiceEmail` VARCHAR(191) NULL,
    ADD COLUMN `legalForm` VARCHAR(64) NULL,
    ADD COLUMN `links` JSON NULL,
    ADD COLUMN `marketingConsent` JSON NULL,
    ADD COLUMN `nextStepDueAt` DATETIME(3) NULL,
    ADD COLUMN `nextStepText` TEXT NULL,
    ADD COLUMN `openingHours` TEXT NULL,
    ADD COLUMN `ownDevices` TEXT NULL,
    ADD COLUMN `paymentTerms` TEXT NULL,
    ADD COLUMN `pkd` JSON NULL,
    ADD COLUMN `regon` VARCHAR(14) NULL,
    ADD COLUMN `seasonality` TEXT NULL,
    ADD COLUMN `services` JSON NULL,
    ADD COLUMN `shortName` VARCHAR(191) NULL,
    ADD COLUMN `smsReminders` BOOLEAN NULL,
    ADD COLUMN `vatStatus` VARCHAR(32) NULL;

-- AlterTable
ALTER TABLE `client_contacts` ADD COLUMN `fieldMeta` JSON NULL,
    ADD COLUMN `preferredChannel` VARCHAR(64) NULL,
    ADD COLUMN `roles` JSON NULL,
    ADD COLUMN `salutation` VARCHAR(191) NULL,
    ADD COLUMN `trainedOn` JSON NULL;

-- CreateTable
CREATE TABLE `client_opportunities` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `device` VARCHAR(191) NOT NULL,
    `stage` VARCHAR(32) NOT NULL,
    `chance` VARCHAR(16) NULL,
    `lastContact` DATETIME(3) NULL,
    `returnAt` DATETIME(3) NULL,
    `note` TEXT NULL,
    `source` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `closedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `client_opportunities_clientId_idx`(`clientId`),
    INDEX `client_opportunities_returnAt_idx`(`returnAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `client_opportunities` ADD CONSTRAINT `client_opportunities_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

