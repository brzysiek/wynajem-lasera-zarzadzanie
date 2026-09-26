-- AlterTable
ALTER TABLE `tasks` ADD COLUMN `clientId` VARCHAR(191) NULL,
    ADD COLUMN `leadId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `messages` ADD COLUMN `clientId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `leads` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NULL,
    `clientContactId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `type` ENUM('POBRANIE_CENNIKA', 'KONTAKT', 'REZERWACJA_WWW', 'SZKOLENIE_WWW', 'TELEFON', 'EMAIL', 'INNE') NOT NULL,
    `stage` ENUM('SYGNAL', 'WYWIAD', 'OFERTA', 'REZERWACJA', 'WYGRANA', 'PRZEGRANA') NOT NULL DEFAULT 'SYGNAL',
    `stageChangedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ownerId` VARCHAR(191) NULL,
    `deviceInterest` JSON NULL,
    `requestedFrom` DATETIME(3) NULL,
    `requestedDays` INTEGER NULL,
    `location` VARCHAR(191) NULL,
    `message` TEXT NULL,
    `contactName` VARCHAR(191) NULL,
    `contactPhone` VARCHAR(191) NULL,
    `contactEmail` VARCHAR(191) NULL,
    `firstContactAt` DATETIME(3) NULL,
    `nextActionAt` DATETIME(3) NULL,
    `lostReason` ENUM('CENA', 'TERMIN_ZAJETY', 'ODLEGLOSC', 'KUPILA_URZADZENIE', 'INNE_URZADZENIE', 'BRAK_KONTAKTU', 'TYLKO_CENNIK', 'ARCHIWUM_IMPORTU', 'INNE') NULL,
    `lostNote` TEXT NULL,
    `returnAt` DATETIME(3) NULL,
    `rentalId` VARCHAR(191) NULL,
    `utmSource` VARCHAR(191) NULL,
    `utmMedium` VARCHAR(191) NULL,
    `utmCampaign` VARCHAR(191) NULL,
    `gclid` VARCHAR(191) NULL,
    `hubspotDealId` VARCHAR(191) NULL,
    `hubspotSnapshot` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `leads_rentalId_key`(`rentalId`),
    UNIQUE INDEX `leads_hubspotDealId_key`(`hubspotDealId`),
    INDEX `leads_stage_idx`(`stage`),
    INDEX `leads_clientId_idx`(`clientId`),
    INDEX `leads_nextActionAt_idx`(`nextActionAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_activities` (
    `id` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NULL,
    `clientId` VARCHAR(191) NULL,
    `type` ENUM('CALL', 'CALL_NO_ANSWER', 'SMS', 'EMAIL', 'NOTE', 'STAGE_CHANGE', 'SYSTEM') NOT NULL,
    `body` TEXT NULL,
    `userId` VARCHAR(191) NULL,
    `messageId` VARCHAR(191) NULL,
    `hubspotEngagementId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `lead_activities_hubspotEngagementId_key`(`hubspotEngagementId`),
    INDEX `lead_activities_leadId_idx`(`leadId`),
    INDEX `lead_activities_clientId_idx`(`clientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `tasks_leadId_idx` ON `tasks`(`leadId`);

-- CreateIndex
CREATE INDEX `tasks_clientId_idx` ON `tasks`(`clientId`);

-- CreateIndex
CREATE INDEX `messages_clientId_idx` ON `messages`(`clientId`);

-- AddForeignKey
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_clientContactId_fkey` FOREIGN KEY (`clientContactId`) REFERENCES `client_contacts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_rentalId_fkey` FOREIGN KEY (`rentalId`) REFERENCES `rentals`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_activities` ADD CONSTRAINT `lead_activities_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_activities` ADD CONSTRAINT `lead_activities_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_activities` ADD CONSTRAINT `lead_activities_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- Domyślne szablony SMS dla Sygnałów (prompt 2, 3.3) — zwykłe, edytowalne
-- szablony (Ustawienia → Szablony SMS). INSERT IGNORE: nie nadpisuje, gdyby
-- już istniały.
INSERT IGNORE INTO `message_templates` (`id`, `key`, `label`, `channel`, `subject`, `body`) VALUES
  (UUID(), 'lead_no_answer', 'Sygnał: nie mogłam się dodzwonić', 'SMS', NULL, 'Dzień dobry, tu WynajemLasera.pl. Nie mogłam się dodzwonić w sprawie Pani zapytania o wynajem. Proszę o informację, kiedy mogę oddzwonić, lub o telefon pod nr {telefon_obslugi}. Pozdrawiam'),
  (UUID(), 'lead_thanks_offer', 'Sygnał: dziękuję za rozmowę — oferta mailem', 'SMS', NULL, 'Dzień dobry, dziękuję za rozmowę. Ofertę wyślę mailem jeszcze dziś. W razie pytań jestem dostępna pod nr {telefon_obslugi}. Pozdrawiam, WynajemLasera.pl'),
  (UUID(), 'lead_offer_reminder', 'Sygnał: przypomnienie o ofercie', 'SMS', NULL, 'Dzień dobry, uprzejmie przypominam o przesłanej ofercie wynajmu. Chętnie odpowiem na pytania i sprawdzę wolne terminy — {telefon_obslugi}. Pozdrawiam, WynajemLasera.pl');
