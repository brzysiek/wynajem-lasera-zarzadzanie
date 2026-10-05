-- AlterTable
ALTER TABLE `webhook_logs` ADD COLUMN `receivedAt` DATETIME(3) NULL,
    ADD COLUMN `tookMs` INTEGER NULL;

-- AlterTable
ALTER TABLE `auto_mails` ADD COLUMN `payload` JSON NULL;

