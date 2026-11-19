-- CreateTable
CREATE TABLE `traffic_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `pv` VARCHAR(40) NOT NULL,
    `path` VARCHAR(200) NOT NULL,
    `dev` VARCHAR(12) NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `channel` VARCHAR(40) NOT NULL,
    `data` JSON NULL,

    INDEX `traffic_events_at_idx`(`at`),
    INDEX `traffic_events_pv_idx`(`pv`),
    INDEX `traffic_events_type_at_idx`(`type`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `traffic_daily` (
    `day` DATE NOT NULL,
    `path` VARCHAR(200) NOT NULL,
    `channel` VARCHAR(40) NOT NULL,
    `dev` VARCHAR(12) NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`day`, `path`, `channel`, `dev`, `type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
