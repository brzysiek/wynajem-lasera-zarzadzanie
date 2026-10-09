-- CreateTable
CREATE TABLE `lead_suggestions` (
    `id` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL,
    `text` TEXT NOT NULL,
    `basis` VARCHAR(500) NULL,
    `authorId` VARCHAR(191) NULL,
    `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `coveredUntil` DATETIME(3) NOT NULL,
    `requestedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `lead_suggestions_leadId_key`(`leadId`),
    INDEX `lead_suggestions_generatedAt_idx`(`generatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `lead_suggestions` ADD CONSTRAINT `lead_suggestions_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

