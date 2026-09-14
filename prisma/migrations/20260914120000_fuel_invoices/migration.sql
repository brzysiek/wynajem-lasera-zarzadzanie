-- Faktury paliwowe wgrywane przez ADMINA (eksport XML) — weryfikacja
-- szacowanego kosztu paliwa (spalanie × odległość × cena/L) względem
-- realnych wydatków. Dopasowanie do pojazdu po nr rej z pola "Nr. Pojazdu"
-- na fakturze (karty paliwowe są wspólne dla floty, stacja i tak pyta o
-- rejestrację przy tankowaniu). Parser: src/lib/costs/fuel-invoice-parse.ts.
CREATE TABLE `fuel_invoices` (
    `id` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `invoiceNumber` VARCHAR(191) NULL,
    `invoiceDate` DATETIME(3) NULL,
    `sellerName` VARCHAR(191) NULL,
    `amountNet` DECIMAL(10, 2) NULL,
    `amountGross` DECIMAL(10, 2) NULL,
    `currency` VARCHAR(191) NULL,
    `rawXml` LONGTEXT NOT NULL,
    `vehiclePlateRaw` VARCHAR(191) NULL,
    `vehicleId` VARCHAR(191) NULL,
    `matchSource` ENUM('AUTO', 'MANUAL') NULL,
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `fuel_invoices_vehicleId_idx`(`vehicleId`),
    INDEX `fuel_invoices_invoiceDate_idx`(`invoiceDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `fuel_invoices` ADD CONSTRAINT `fuel_invoices_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
