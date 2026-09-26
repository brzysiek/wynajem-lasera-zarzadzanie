-- AlterTable
ALTER TABLE `clients` ADD COLUMN `qualifiedAt` DATETIME(3) NULL,
    ADD COLUMN `qualifiedReason` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `leads` ADD COLUMN `callList` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX `leads_callList_idx` ON `leads`(`callList`);

