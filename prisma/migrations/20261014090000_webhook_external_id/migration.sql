-- AlterTable
ALTER TABLE `webhook_logs` ADD COLUMN `externalId` VARCHAR(100) NULL;

-- CreateIndex
CREATE INDEX `webhook_logs_kind_externalId_idx` ON `webhook_logs`(`kind`, `externalId`);

