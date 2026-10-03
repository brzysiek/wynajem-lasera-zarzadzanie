-- CreateTable
CREATE TABLE `email_template_attachments` (
    `id` VARCHAR(191) NOT NULL,
    `templateKey` VARCHAR(64) NOT NULL,
    `filename` VARCHAR(191) NOT NULL,
    `mime` VARCHAR(100) NOT NULL,
    `size` INTEGER NOT NULL,
    `data` LONGBLOB NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `email_template_attachments_templateKey_idx`(`templateKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auto_mails` (
    `id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `leadId` VARCHAR(191) NULL,
    `clientId` VARCHAR(191) NULL,
    `toAddress` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `subject` TEXT NULL,
    `status` VARCHAR(12) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lockedAt` DATETIME(3) NULL,
    `error` TEXT NULL,
    `gmailMessageId` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sentAt` DATETIME(3) NULL,

    INDEX `auto_mails_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `auto_mails_gmailMessageId_idx`(`gmailMessageId`),
    INDEX `auto_mails_toAddress_createdAt_idx`(`toAddress`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

