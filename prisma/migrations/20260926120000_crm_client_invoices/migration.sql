-- AlterTable
ALTER TABLE `rental_history` MODIFY `matchMethod` ENUM('NIP', 'EMAIL', 'PHONE', 'NAME_AUTO', 'MANUAL', 'RENTAL') NULL;

-- CreateTable
CREATE TABLE `client_invoices` (
    `id` VARCHAR(191) NOT NULL,
    `fakturowniaInvoiceId` INTEGER NOT NULL,
    `number` VARCHAR(191) NOT NULL,
    `issueDate` DATETIME(3) NOT NULL,
    `sellDate` DATETIME(3) NOT NULL,
    `buyerName` VARCHAR(191) NOT NULL,
    `buyerTaxNo` VARCHAR(191) NULL,
    `buyerKey` VARCHAR(191) NOT NULL,
    `totalNet` DECIMAL(10, 2) NOT NULL,
    `totalGross` DECIMAL(10, 2) NOT NULL,
    `positionsSummary` TEXT NULL,
    `clientId` VARCHAR(191) NULL,
    `rentalId` VARCHAR(191) NULL,
    `candidates` JSON NULL,
    `matchMethod` ENUM('NIP', 'EMAIL', 'PHONE', 'NAME_AUTO', 'MANUAL', 'RENTAL') NULL,
    `matchState` ENUM('AUTO', 'SUGGESTED', 'CONFIRMED', 'IGNORED', 'UNMATCHED') NOT NULL DEFAULT 'UNMATCHED',
    `matchScore` DOUBLE NULL,
    `matchedByUserId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `client_invoices_fakturowniaInvoiceId_key`(`fakturowniaInvoiceId`),
    INDEX `client_invoices_clientId_idx`(`clientId`),
    INDEX `client_invoices_buyerTaxNo_idx`(`buyerTaxNo`),
    INDEX `client_invoices_matchState_idx`(`matchState`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `client_invoices` ADD CONSTRAINT `client_invoices_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

