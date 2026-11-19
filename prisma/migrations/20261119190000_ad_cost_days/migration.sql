-- CreateTable
CREATE TABLE `ad_cost_days` (
    `id` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(16) NOT NULL DEFAULT 'GOOGLE_ADS',
    `day` DATE NOT NULL,
    `campaignKey` VARCHAR(120) NOT NULL,
    `campaignName` VARCHAR(191) NOT NULL,
    `adGroupId` VARCHAR(40) NOT NULL DEFAULT '',
    `adGroupName` VARCHAR(150) NOT NULL DEFAULT '',
    `keyword` VARCHAR(150) NOT NULL DEFAULT '',
    `keywordText` VARCHAR(191) NOT NULL DEFAULT '',
    `impressions` INTEGER NOT NULL DEFAULT 0,
    `clicks` INTEGER NOT NULL DEFAULT 0,
    `cost` DECIMAL(12, 2) NOT NULL,
    `importBatch` VARCHAR(40) NOT NULL,
    `importedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ad_cost_days_day_idx`(`day`),
    UNIQUE INDEX `ad_cost_days_uniq`(`channel`, `day`, `campaignKey`, `adGroupId`, `adGroupName`, `keyword`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
