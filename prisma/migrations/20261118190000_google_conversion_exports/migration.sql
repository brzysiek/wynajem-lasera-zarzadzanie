-- CreateTable
CREATE TABLE `google_conversion_exports` (
    `id` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `conversionName` VARCHAR(80) NOT NULL,
    `value` DECIMAL(10, 2) NULL,
    `clickIdKind` VARCHAR(8) NOT NULL,
    `conversionAt` DATETIME(3) NOT NULL,
    `exportedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `batch` VARCHAR(40) NOT NULL,

    UNIQUE INDEX `google_conversion_exports_orderId_key`(`orderId`),
    INDEX `google_conversion_exports_leadId_idx`(`leadId`),
    INDEX `google_conversion_exports_batch_idx`(`batch`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `google_conversion_exports` ADD CONSTRAINT `google_conversion_exports_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
