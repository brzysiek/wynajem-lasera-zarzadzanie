-- AlterTable
ALTER TABLE `email_messages` ADD COLUMN `hiddenById` VARCHAR(191) NULL,
    ADD COLUMN `hiddenReason` VARCHAR(16) NULL;

-- CreateTable
CREATE TABLE `email_exclusions` (
    `id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `value` VARCHAR(191) NOT NULL,
    `note` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `email_exclusions_value_key`(`value`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

