-- Incremental migration: adds a `source` column to reminder_check_logs so the
-- history can show whether a check was triggered by the cron job or by the
-- admin's manual "Wyślij teraz" button (sql/schema.sql already has this
-- column for fresh installs — this file is for applying the same change to
-- prod).
-- Apply once on the production database:
--   mysql -u USER -p DBNAME < sql/2026-07-28_add_reminder_check_log_source.sql

ALTER TABLE `reminder_check_logs`
    ADD COLUMN `source` ENUM('CRON', 'MANUAL') NOT NULL DEFAULT 'CRON' AFTER `failedCount`;

-- Rows that already exist at migration time predate this column and have no
-- real record of which trigger fired them — mark them as manual runs.
UPDATE `reminder_check_logs` SET `source` = 'MANUAL';
