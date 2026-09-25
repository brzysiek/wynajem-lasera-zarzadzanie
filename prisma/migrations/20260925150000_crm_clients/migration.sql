-- CRM, etap 1A: klienci (gabinety) i osoby kontaktowe. WYŁĄCZNIE dodające —
-- nowe tabele + dwie nowe, puste (NULL) kolumny na `rentals`. Żadna
-- istniejąca kolumna ani dane nie są zmieniane; istniejący kod ich nie czyta.
-- FK z `rentals` mają ON DELETE SET NULL — usunięcie klienta/osoby nigdy nie
-- usuwa wynajmu. SQL wygenerowany `prisma migrate diff` ze schematu.

-- AlterTable
ALTER TABLE `rentals` ADD COLUMN `clientContactId` VARCHAR(191) NULL,
    ADD COLUMN `clientId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `clients` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `nip` VARCHAR(191) NULL,
    `street` VARCHAR(191) NULL,
    `zip` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `country` VARCHAR(191) NULL DEFAULT 'Polska',
    `transportPriceNet` DECIMAL(10, 2) NULL,
    `distanceKm` DECIMAL(6, 1) NULL,
    `clinicType` ENUM('GABINET_KOSMETOLOGICZNY', 'KLINIKA_MEDYCYNY_ESTETYCZNEJ', 'SALON_BEAUTY', 'KOSMETOLOG_MOBILNY', 'INNE') NULL,
    `source` ENUM('FORMULARZ_WWW', 'TELEFON', 'POLECENIE', 'GOOGLE_ADS', 'META', 'POWRACAJACY', 'INNE') NULL,
    `deviceInterests` JSON NULL,
    `statusOverride` ENUM('NIE_KONTAKTOWAC') NULL,
    `notes` TEXT NULL,
    `hubspotCompanyId` VARCHAR(191) NULL,
    `legacyHubspotTag` VARCHAR(191) NULL,
    `hubspotSnapshot` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `clients_hubspotCompanyId_key`(`hubspotCompanyId`),
    INDEX `clients_nip_idx`(`nip`),
    INDEX `clients_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `client_contacts` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(191) NULL,
    `lastName` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `role` VARCHAR(191) NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `hubspotContactId` VARCHAR(191) NULL,
    `hubspotSnapshot` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `client_contacts_hubspotContactId_key`(`hubspotContactId`),
    INDEX `client_contacts_clientId_idx`(`clientId`),
    INDEX `client_contacts_email_idx`(`email`),
    INDEX `client_contacts_phone_idx`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `rentals_clientId_idx` ON `rentals`(`clientId`);

-- CreateIndex
CREATE INDEX `rentals_clientContactId_idx` ON `rentals`(`clientContactId`);

-- AddForeignKey
ALTER TABLE `rentals` ADD CONSTRAINT `rentals_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rentals` ADD CONSTRAINT `rentals_clientContactId_fkey` FOREIGN KEY (`clientContactId`) REFERENCES `client_contacts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_contacts` ADD CONSTRAINT `client_contacts_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

