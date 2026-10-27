-- AlterTable
ALTER TABLE `leads` MODIFY `type` ENUM('POBRANIE_CENNIKA', 'KONTAKT', 'REZERWACJA_WWW', 'SZKOLENIE_WWW', 'TELEFON', 'EMAIL', 'OLX', 'POLECENIE', 'INNE', 'MESSENGER', 'INSTAGRAM') NOT NULL;

-- CreateTable
CREATE TABLE `chat_threads` (
    `id` VARCHAR(191) NOT NULL,
    `channel` ENUM('MESSENGER', 'INSTAGRAM') NOT NULL,
    `externalUserId` VARCHAR(64) NOT NULL,
    `pageId` VARCHAR(64) NULL,
    `displayName` VARCHAR(191) NULL,
    `clientId` VARCHAR(191) NULL,
    `leadId` VARCHAR(191) NULL,
    `lastInboundAt` DATETIME(3) NULL,
    `lastOutboundAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `chat_threads_leadId_idx`(`leadId`),
    INDEX `chat_threads_clientId_idx`(`clientId`),
    UNIQUE INDEX `chat_threads_channel_externalUserId_key`(`channel`, `externalUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_messages` (
    `id` VARCHAR(191) NOT NULL,
    `threadId` VARCHAR(191) NOT NULL,
    `mid` VARCHAR(191) NOT NULL,
    `direction` ENUM('IN', 'OUT') NOT NULL,
    `text` TEXT NULL,
    `attachments` JSON NULL,
    `sentAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `chat_messages_mid_key`(`mid`),
    INDEX `chat_messages_threadId_sentAt_idx`(`threadId`, `sentAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_merge_suggestions` (
    `id` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL,
    `otherLeadId` VARCHAR(191) NULL,
    `otherClientId` VARCHAR(191) NULL,
    `label` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `decidedById` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lead_merge_suggestions_status_idx`(`status`),
    INDEX `lead_merge_suggestions_leadId_idx`(`leadId`),
    INDEX `lead_merge_suggestions_otherLeadId_idx`(`otherLeadId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `chat_threads` ADD CONSTRAINT `chat_threads_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_threads` ADD CONSTRAINT `chat_threads_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_threadId_fkey` FOREIGN KEY (`threadId`) REFERENCES `chat_threads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_merge_suggestions` ADD CONSTRAINT `lead_merge_suggestions_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_merge_suggestions` ADD CONSTRAINT `lead_merge_suggestions_otherLeadId_fkey` FOREIGN KEY (`otherLeadId`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_merge_suggestions` ADD CONSTRAINT `lead_merge_suggestions_otherClientId_fkey` FOREIGN KEY (`otherClientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

