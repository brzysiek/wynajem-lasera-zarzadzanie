-- AlterTable
ALTER TABLE `clients` MODIFY `statusOverride` ENUM('NIE_KONTAKTOWAC', 'USPIONY') NULL,
    ADD COLUMN `statusOverrideAt` DATETIME(3) NULL,
    ADD COLUMN `dormantReason` VARCHAR(24) NULL,
    ADD COLUMN `dormantReturnAt` DATE NULL;
