-- Incremental migration: adds the reminder-check history table to an
-- already-provisioned database (sql/schema.sql already has this table for
-- fresh installs — this file is for applying the same change to prod).
-- Apply once on the production database:
--   mysql -u USER -p DBNAME < sql/2026-07-27_add_reminder_check_logs.sql

CREATE TABLE `reminder_check_logs` (
    `id` VARCHAR(191) NOT NULL,
    `rentalsChecked` INTEGER NOT NULL,
    `dueCount` INTEGER NOT NULL,
    `sentCount` INTEGER NOT NULL,
    `failedCount` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
