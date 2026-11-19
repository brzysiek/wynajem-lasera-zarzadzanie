-- CreateTable
CREATE TABLE `marketing_keyword_ratings` (
    `id` VARCHAR(191) NOT NULL,
    `campaignKey` VARCHAR(120) NOT NULL,
    `campaignName` VARCHAR(191) NOT NULL,
    `keyword` VARCHAR(150) NOT NULL,
    `keywordText` VARCHAR(191) NOT NULL,
    `rating` VARCHAR(20) NOT NULL,
    `reason` TEXT NULL,
    `ratedByName` VARCHAR(80) NOT NULL,
    `ratedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `mkt_keyword_rating_uniq`(`campaignKey`, `keyword`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `marketing_reports` (
    `id` VARCHAR(191) NOT NULL,
    `periodFrom` DATE NOT NULL,
    `periodTo` DATE NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `conclusions` JSON NOT NULL,
    `contentMd` LONGTEXT NOT NULL,
    `author` VARCHAR(80) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `marketing_reports_periodTo_idx`(`periodTo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `marketing_proposals` (
    `id` VARCHAR(191) NOT NULL,
    `reportId` VARCHAR(191) NOT NULL,
    `area` VARCHAR(16) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `reasoning` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'czeka',
    `decidedByName` VARCHAR(80) NULL,
    `decidedAt` DATETIME(3) NULL,
    `comment` TEXT NULL,
    `implementedAt` DATETIME(3) NULL,
    `implementedBy` VARCHAR(80) NULL,
    `implementedNote` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `marketing_proposals_reportId_idx`(`reportId`),
    INDEX `marketing_proposals_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `marketing_proposals` ADD CONSTRAINT `marketing_proposals_reportId_fkey` FOREIGN KEY (`reportId`) REFERENCES `marketing_reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
