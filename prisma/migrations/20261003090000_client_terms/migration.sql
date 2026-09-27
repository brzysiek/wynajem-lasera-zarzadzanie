-- AlterTable
ALTER TABLE `rental_finance` ADD COLUMN `invoiceNet` DECIMAL(10, 2) NULL,
    MODIFY `baseRentalPriceSource` ENUM('PRICE_LIST', 'MANUAL', 'PULSE_CALCULATED', 'CLIENT_TERMS') NOT NULL;

-- AlterTable
ALTER TABLE `clients` ADD COLUMN `invoiceMode` VARCHAR(8) NULL,
    ADD COLUMN `invoicePartDefault` DECIMAL(10, 2) NULL,
    ADD COLUMN `paymentTermDays` INTEGER NULL,
    ADD COLUMN `pulseRateNet` DECIMAL(10, 4) NULL,
    ADD COLUMN `pulsesCharged` BOOLEAN NULL;

-- CreateTable
CREATE TABLE `client_prices` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `device` VARCHAR(24) NOT NULL,
    `days` INTEGER NOT NULL,
    `priceNet` DECIMAL(10, 2) NOT NULL,
    `source` VARCHAR(32) NULL,
    `sourceRef` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `client_prices_clientId_device_days_key`(`clientId`, `device`, `days`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `client_prices` ADD CONSTRAINT `client_prices_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

