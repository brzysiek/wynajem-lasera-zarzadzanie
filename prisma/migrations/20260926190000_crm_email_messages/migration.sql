-- AlterTable
ALTER TABLE `rental_history` MODIFY `matchMethod` ENUM('NIP', 'EMAIL', 'PHONE', 'NAME_AUTO', 'MANUAL', 'RENTAL', 'DOMAIN') NULL;

-- AlterTable
ALTER TABLE `client_invoices` MODIFY `matchMethod` ENUM('NIP', 'EMAIL', 'PHONE', 'NAME_AUTO', 'MANUAL', 'RENTAL', 'DOMAIN') NULL;

-- CreateTable
CREATE TABLE `email_messages` (
    `id` VARCHAR(191) NOT NULL,
    `mailbox` VARCHAR(191) NOT NULL,
    `gmailMessageId` VARCHAR(191) NOT NULL,
    `gmailThreadId` VARCHAR(191) NOT NULL,
    `rfcMessageId` VARCHAR(512) NULL,
    `direction` ENUM('IN', 'OUT') NOT NULL,
    `fromAddress` VARCHAR(191) NOT NULL,
    `toAddresses` JSON NOT NULL,
    `ccAddresses` JSON NULL,
    `subject` TEXT NULL,
    `snippet` TEXT NULL,
    `hasAttachments` BOOLEAN NOT NULL DEFAULT false,
    `sentAt` DATETIME(3) NOT NULL,
    `clientId` VARCHAR(191) NULL,
    `clientContactId` VARCHAR(191) NULL,
    `matchMethod` ENUM('NIP', 'EMAIL', 'PHONE', 'NAME_AUTO', 'MANUAL', 'RENTAL', 'DOMAIN') NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `email_messages_clientId_sentAt_idx`(`clientId`, `sentAt`),
    INDEX `email_messages_rfcMessageId_idx`(`rfcMessageId`),
    UNIQUE INDEX `email_messages_mailbox_gmailMessageId_key`(`mailbox`, `gmailMessageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `email_messages` ADD CONSTRAINT `email_messages_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

