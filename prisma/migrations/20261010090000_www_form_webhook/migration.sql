-- AlterTable
ALTER TABLE `leads` ADD COLUMN `attribution` JSON NULL,
    ADD COLUMN `origin` VARCHAR(12) NULL;

-- CreateTable
CREATE TABLE `webhook_logs` (
    `id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `result` VARCHAR(16) NOT NULL,
    `leadId` VARCHAR(191) NULL,
    `message` TEXT NULL,
    `payload` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `webhook_logs_kind_createdAt_idx`(`kind`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

