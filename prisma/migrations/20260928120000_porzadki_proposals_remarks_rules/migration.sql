-- CreateTable
CREATE TABLE `proposals` (
    `id` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `area` VARCHAR(32) NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `problem` TEXT NULL,
    `evidence` TEXT NULL,
    `scale` VARCHAR(191) NULL,
    `causes` JSON NULL,
    `proposal` TEXT NULL,
    `priority` VARCHAR(8) NOT NULL DEFAULT 'MEDIUM',
    `priorityReason` VARCHAR(191) NULL,
    `blocksCleanup` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(16) NOT NULL DEFAULT 'NOWY',
    `decision` TEXT NULL,
    `authorId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `proposals_number_key`(`number`),
    INDEX `proposals_status_idx`(`status`),
    INDEX `proposals_area_idx`(`area`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `proposal_clients` (
    `proposalId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,

    INDEX `proposal_clients_clientId_idx`(`clientId`),
    PRIMARY KEY (`proposalId`, `clientId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `proposal_relations` (
    `id` VARCHAR(191) NOT NULL,
    `fromId` VARCHAR(191) NOT NULL,
    `toId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,

    INDEX `proposal_relations_toId_idx`(`toId`),
    UNIQUE INDEX `proposal_relations_fromId_toId_kind_key`(`fromId`, `toId`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `proposal_comments` (
    `id` VARCHAR(191) NOT NULL,
    `proposalId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `proposal_comments_proposalId_idx`(`proposalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `proposal_status_changes` (
    `id` VARCHAR(191) NOT NULL,
    `proposalId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `fromStatus` VARCHAR(16) NULL,
    `toStatus` VARCHAR(16) NOT NULL,
    `comment` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `proposal_status_changes_proposalId_idx`(`proposalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `remarks` (
    `id` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `area` VARCHAR(32) NULL,
    `evidence` TEXT NULL,
    `status` VARCHAR(8) NOT NULL DEFAULT 'OPEN',
    `clientId` VARCHAR(191) NULL,
    `leadId` VARCHAR(191) NULL,
    `proposalId` VARCHAR(191) NULL,
    `authorId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `remarks_clientId_idx`(`clientId`),
    INDEX `remarks_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cleanup_rules` (
    `id` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `example` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `proposals` ADD CONSTRAINT `proposals_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proposal_clients` ADD CONSTRAINT `proposal_clients_proposalId_fkey` FOREIGN KEY (`proposalId`) REFERENCES `proposals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proposal_clients` ADD CONSTRAINT `proposal_clients_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proposal_relations` ADD CONSTRAINT `proposal_relations_fromId_fkey` FOREIGN KEY (`fromId`) REFERENCES `proposals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proposal_relations` ADD CONSTRAINT `proposal_relations_toId_fkey` FOREIGN KEY (`toId`) REFERENCES `proposals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proposal_comments` ADD CONSTRAINT `proposal_comments_proposalId_fkey` FOREIGN KEY (`proposalId`) REFERENCES `proposals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proposal_comments` ADD CONSTRAINT `proposal_comments_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proposal_status_changes` ADD CONSTRAINT `proposal_status_changes_proposalId_fkey` FOREIGN KEY (`proposalId`) REFERENCES `proposals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proposal_status_changes` ADD CONSTRAINT `proposal_status_changes_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remarks` ADD CONSTRAINT `remarks_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remarks` ADD CONSTRAINT `remarks_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remarks` ADD CONSTRAINT `remarks_proposalId_fkey` FOREIGN KEY (`proposalId`) REFERENCES `proposals`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remarks` ADD CONSTRAINT `remarks_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cleanup_rules` ADD CONSTRAINT `cleanup_rules_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

