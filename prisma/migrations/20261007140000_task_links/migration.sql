-- CreateTable
CREATE TABLE `task_links` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `refId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `task_links_kind_refId_idx`(`kind`, `refId`),
    UNIQUE INDEX `task_links_taskId_kind_refId_key`(`taskId`, `kind`, `refId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `task_links` ADD CONSTRAINT `task_links_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Dotychczasowe powiązania zadań (klient, sygnał) jako wpisy task_links —
-- pola tasks.clientId / leadId zostają dla zgodności
INSERT IGNORE INTO `task_links` (`id`, `taskId`, `kind`, `refId`)
SELECT UUID(), t.`id`, 'CLIENT', t.`clientId` FROM `tasks` t WHERE t.`clientId` IS NOT NULL;
INSERT IGNORE INTO `task_links` (`id`, `taskId`, `kind`, `refId`)
SELECT UUID(), t.`id`, 'LEAD', t.`leadId` FROM `tasks` t WHERE t.`leadId` IS NOT NULL;
