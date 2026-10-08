-- CreateTable
CREATE TABLE `lead_email_drafts` (
    `id` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NULL,
    `status` VARCHAR(16) NOT NULL,
    `authorKind` VARCHAR(8) NOT NULL,
    `authorId` VARCHAR(191) NULL,
    `editedByUser` BOOLEAN NOT NULL DEFAULT false,
    `toAddress` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(255) NOT NULL,
    `bodyText` TEXT NOT NULL,
    `note` TEXT NULL,
    `replyToEmailId` VARCHAR(191) NULL,
    `gmailDraftId` VARCHAR(64) NULL,
    `gmailThreadId` VARCHAR(64) NULL,
    `gmailMessageId` VARCHAR(64) NULL,
    `contentUpdatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `gmailSavedAt` DATETIME(3) NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `lead_email_drafts_leadId_status_idx`(`leadId`, `status`),
    INDEX `lead_email_drafts_gmailThreadId_idx`(`gmailThreadId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `lead_email_drafts` ADD CONSTRAINT `lead_email_drafts_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

