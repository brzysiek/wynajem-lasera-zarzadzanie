-- Moduł kosztów (docs/prompt-claude-code-dashboard-kosztow.md): Vehicle,
-- CostCategory (zarządzana tabela, nie luźny string), Cost, plus
-- rozszerzenia Rental (vehicleId, contactDistanceKm) i User (hourlyRate,
-- tylko dla roli KIEROWCA — patrz reguła bezpieczeństwa w schema.prisma).

-- AlterTable
ALTER TABLE `users` ADD COLUMN `hourlyRate` DECIMAL(8, 2) NULL;

-- CreateTable
CREATE TABLE `vehicles` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `plateNumber` VARCHAR(191) NOT NULL,
    `fuelCostPerKm` DECIMAL(6, 2) NOT NULL,
    `fuelCostUpdatedAt` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cost_categories` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `scope` ENUM('GENERAL', 'VEHICLE', 'DEVICE') NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `cost_categories_name_scope_key`(`name`, `scope`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `costs` (
    `id` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `scope` ENUM('GENERAL', 'VEHICLE', 'DEVICE') NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `deviceId` VARCHAR(191) NULL,
    `vehicleId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `costs_scope_idx`(`scope`),
    INDEX `costs_date_idx`(`date`),
    INDEX `costs_deviceId_idx`(`deviceId`),
    INDEX `costs_vehicleId_idx`(`vehicleId`),
    INDEX `costs_categoryId_idx`(`categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `costs` ADD CONSTRAINT `costs_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `cost_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `costs` ADD CONSTRAINT `costs_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `devices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `costs` ADD CONSTRAINT `costs_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: powiązanie wynajmu z pojazdem + odległość do klienta (km),
-- podstawa wyliczenia kosztu paliwa per wynajem (sekcja 3.1).
ALTER TABLE `rentals` ADD COLUMN `vehicleId` VARCHAR(191) NULL;
ALTER TABLE `rentals` ADD COLUMN `contactDistanceKm` DECIMAL(6, 1) NULL;

-- CreateIndex
CREATE INDEX `rentals_vehicleId_idx` ON `rentals`(`vehicleId`);

-- AddForeignKey
ALTER TABLE `rentals` ADD CONSTRAINT `rentals_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Dane startowe CostCategory (sekcja 2). „Paliwo" celowo nie jest tu
-- kategorią — koszt paliwa liczy się automatycznie per wynajem (sekcja 3.1),
-- nie jako ręczny wpis Cost.
INSERT INTO `cost_categories` (`id`, `name`, `scope`, `updatedAt`) VALUES
    (UUID(), 'Marketing', 'GENERAL', CURRENT_TIMESTAMP(3)),
    (UUID(), 'Hosting/serwer', 'GENERAL', CURRENT_TIMESTAMP(3)),
    (UUID(), 'Księgowość/prawne', 'GENERAL', CURRENT_TIMESTAMP(3)),
    (UUID(), 'Wynagrodzenia biura', 'GENERAL', CURRENT_TIMESTAMP(3)),
    (UUID(), 'Inne ogólne', 'GENERAL', CURRENT_TIMESTAMP(3)),
    (UUID(), 'Serwis/przegląd', 'VEHICLE', CURRENT_TIMESTAMP(3)),
    (UUID(), 'Ubezpieczenie', 'VEHICLE', CURRENT_TIMESTAMP(3)),
    (UUID(), 'Rata/leasing', 'VEHICLE', CURRENT_TIMESTAMP(3)),
    (UUID(), 'Serwis/przegląd', 'DEVICE', CURRENT_TIMESTAMP(3)),
    (UUID(), 'Materiały eksploatacyjne', 'DEVICE', CURRENT_TIMESTAMP(3)),
    (UUID(), 'Wymiana lampy/elementu zużywalnego', 'DEVICE', CURRENT_TIMESTAMP(3));
