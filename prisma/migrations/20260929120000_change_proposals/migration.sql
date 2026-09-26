-- CreateTable
CREATE TABLE `change_proposals` (
    `id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `clientId` VARCHAR(191) NULL,
    `contactId` VARCHAR(191) NULL,
    `leadId` VARCHAR(191) NULL,
    `field` VARCHAR(64) NULL,
    `currentValue` TEXT NULL,
    `proposedValue` TEXT NULL,
    `source` TEXT NOT NULL,
    `confidence` VARCHAR(8) NOT NULL,
    `batch` VARCHAR(64) NULL,
    `changeClass` VARCHAR(64) NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    `autoApproved` BOOLEAN NOT NULL DEFAULT false,
    `authorId` VARCHAR(191) NULL,
    `editedById` VARCHAR(191) NULL,
    `decidedById` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionComment` TEXT NULL,
    `executedAt` DATETIME(3) NULL,
    `executionError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `change_proposals_status_idx`(`status`),
    INDEX `change_proposals_batch_idx`(`batch`),
    INDEX `change_proposals_clientId_idx`(`clientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auto_approved_classes` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `label` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `auto_approved_classes_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `change_proposals` ADD CONSTRAINT `change_proposals_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

