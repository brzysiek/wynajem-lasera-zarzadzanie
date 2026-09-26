-- AlterTable
ALTER TABLE `users` MODIFY `role` ENUM('ADMIN', 'STAFF', 'KIEROWCA', 'AGENT') NOT NULL DEFAULT 'STAFF';

-- AlterTable
ALTER TABLE `lead_activities` ADD COLUMN `editedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `change_logs` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` VARCHAR(191) NULL,
    `clientId` VARCHAR(191) NULL,
    `clientName` VARCHAR(191) NULL,
    `entity` VARCHAR(32) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `operation` VARCHAR(32) NOT NULL,
    `field` VARCHAR(64) NULL,
    `before` TEXT NULL,
    `after` TEXT NULL,
    `source` TEXT NULL,
    `confidence` VARCHAR(8) NULL,
    `batch` VARCHAR(64) NULL,
    `approvedById` VARCHAR(191) NULL,
    `undoneById` VARCHAR(191) NULL,
    `undoOfId` VARCHAR(191) NULL,

    INDEX `change_logs_clientId_createdAt_idx`(`clientId`, `createdAt`),
    INDEX `change_logs_batch_idx`(`batch`),
    INDEX `change_logs_createdAt_idx`(`createdAt`),
    INDEX `change_logs_userId_idx`(`userId`),
    INDEX `change_logs_entity_entityId_idx`(`entity`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_comments` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `task_comments_taskId_idx`(`taskId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `change_logs` ADD CONSTRAINT `change_logs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `change_logs` ADD CONSTRAINT `change_logs_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_comments` ADD CONSTRAINT `task_comments_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_comments` ADD CONSTRAINT `task_comments_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- Konto agenta AI „Klaudiusz” (kontakt+claude@wynajemlasera.pl) dostaje rolę
-- AGENT i traci tryb kierowcy. Na serwerze bez tego konta — nic się nie dzieje.
UPDATE `users` SET `role` = 'AGENT', `canActAsDriver` = false
WHERE `id` = '67b9d851-486e-4772-913a-77e194873213' AND `email` = 'kontakt+claude@wynajemlasera.pl';
