-- AlterTable
ALTER TABLE `clients` ADD COLUMN `archiveBatch` VARCHAR(64) NULL,
    ADD COLUMN `archiveNote` TEXT NULL,
    ADD COLUMN `archiveReason` VARCHAR(32) NULL,
    ADD COLUMN `archivedAt` DATETIME(3) NULL,
    ADD COLUMN `archivedById` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `leads` ADD COLUMN `archiveBatch` VARCHAR(64) NULL,
    ADD COLUMN `archiveNote` TEXT NULL,
    ADD COLUMN `archiveReason` VARCHAR(32) NULL,
    ADD COLUMN `archivedAt` DATETIME(3) NULL,
    ADD COLUMN `archivedById` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `import_blocks` (
    `id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `hubspotId` VARCHAR(64) NOT NULL,
    `label` VARCHAR(191) NULL,
    `reason` VARCHAR(32) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `import_blocks_kind_hubspotId_key`(`kind`, `hubspotId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `clients_archivedAt_idx` ON `clients`(`archivedAt`);

-- CreateIndex
CREATE INDEX `leads_archivedAt_idx` ON `leads`(`archivedAt`);

