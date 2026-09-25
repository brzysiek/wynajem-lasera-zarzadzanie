-- CreateTable
CREATE TABLE `rental_history` (
    `id` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `googleCalendarId` VARCHAR(191) NOT NULL,
    `googleEventId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `titleKey` VARCHAR(191) NOT NULL,
    `candidates` JSON NULL,
    `clientId` VARCHAR(191) NULL,
    `matchMethod` ENUM('NIP', 'EMAIL', 'PHONE', 'NAME_AUTO', 'MANUAL') NULL,
    `matchState` ENUM('AUTO', 'SUGGESTED', 'CONFIRMED', 'IGNORED', 'UNMATCHED') NOT NULL DEFAULT 'UNMATCHED',
    `matchScore` DOUBLE NULL,
    `matchedByUserId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_history_clientId_idx`(`clientId`),
    INDEX `rental_history_matchState_idx`(`matchState`),
    INDEX `rental_history_titleKey_idx`(`titleKey`),
    UNIQUE INDEX `rental_history_googleCalendarId_googleEventId_key`(`googleCalendarId`, `googleEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `client_aliases` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `alias` VARCHAR(191) NOT NULL,
    `createdByUserId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `client_aliases_alias_key`(`alias`),
    INDEX `client_aliases_clientId_idx`(`clientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `rental_history` ADD CONSTRAINT `rental_history_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `devices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_history` ADD CONSTRAINT `rental_history_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_aliases` ADD CONSTRAINT `client_aliases_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

